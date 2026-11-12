//! What a picture is: the extensions a picture file has, and its type read
//! from its bytes rather than its name or a server's word for it.

use std::path::Path;

/// A picture file's extensions, lower case.
pub const PICTURE_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "tif", "tiff", "avif", "ico", "heic", "heif",
];

/// Whether `path` names a picture file.
pub fn is_picture(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| PICTURE_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
}

/// The picture type `bytes` are, from their signature.
pub fn sniff(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("image/jpeg")
    } else if bytes.starts_with(b"GIF8") {
        Some("image/gif")
    } else if bytes.len() > 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else if bytes.len() > 12 && &bytes[4..12] == b"ftypavif" {
        Some("image/avif")
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_picture_by_its_name_and_by_its_bytes() {
        for name in ["a.PNG", "b.tiff", "c.avif", "d.svg"] {
            assert!(is_picture(Path::new(name)), "{name}");
        }
        assert!(!is_picture(Path::new("notes.md")));
        assert_eq!(sniff(b"GIF89a.."), Some("image/gif"));
        assert_eq!(sniff(b"\x89PNG\r\n\x1a\n...."), Some("image/png"));
        assert_eq!(sniff(b"<svg"), None);
    }
}
