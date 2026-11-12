//! Attached pictures as every model reads them: PNG, JPEG, GIF or WebP,
//! under the size limit and no longer than LONG_SIDE on the long side.

use crate::extract::{image_mime, MAX_IMAGE_BYTES};
use image::{DynamicImage, ImageFormat};
use std::io::Cursor;
use std::path::Path;

/// Longest side a picture is sent at; models scale larger ones down anyway.
const LONG_SIDE: u32 = 2048;

/// The extensions attached as pictures, sent as they are or converted.
pub(super) const PICTURE_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "bmp", "tif", "tiff", "ico", "heic", "heif", "avif",
];

pub(super) struct Picture {
    pub mime: &'static str,
    pub bytes: Vec<u8>,
}

/// Reads the picture at `path`, converting and shrinking it as needed.
pub(super) fn picture(path: &Path, ext: &str) -> Result<Picture, String> {
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    if let Some(mime) = image_mime(ext) {
        if bytes.len() as u64 <= MAX_IMAGE_BYTES {
            return Ok(Picture { mime, bytes });
        }
    }
    let decoded = match ext {
        "heic" | "heif" | "avif" => system_decode(path)?,
        _ => image::load_from_memory(&bytes)
            .map_err(|_| crate::errors::error("pictureUnreadable"))?,
    };
    encode(decoded)
}

/// PNG when it has transparency, JPEG otherwise, at LONG_SIDE at most.
fn encode(picture: DynamicImage) -> Result<Picture, String> {
    let picture = if picture.width().max(picture.height()) > LONG_SIDE {
        picture.resize(LONG_SIDE, LONG_SIDE, image::imageops::FilterType::Triangle)
    } else {
        picture
    };
    let mut bytes = Vec::new();
    let (mime, format) = if picture.color().has_alpha() {
        ("image/png", ImageFormat::Png)
    } else {
        ("image/jpeg", ImageFormat::Jpeg)
    };
    let picture = if format == ImageFormat::Jpeg {
        DynamicImage::ImageRgb8(picture.to_rgb8())
    } else {
        picture
    };
    picture
        .write_to(&mut Cursor::new(&mut bytes), format)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_IMAGE_BYTES {
        return Err(crate::errors::error("pictureTooLarge"));
    }
    Ok(Picture { mime, bytes })
}

/// HEIC and AVIF, which only the system can read: on macOS `sips` turns it
/// into a PNG first.
#[cfg(target_os = "macos")]
fn system_decode(path: &Path) -> Result<DynamicImage, String> {
    let out = crate::atomic::TempFile::create("textus-picture-", ".png", b"")
        .map_err(|e| e.to_string())?;
    let status = std::process::Command::new("/usr/bin/sips")
        .args(["-s", "format", "png"])
        .arg(path)
        .arg("--out")
        .arg(out.path())
        .output()
        .map_err(|e| e.to_string())?;
    if !status.status.success() {
        return Err(crate::errors::error("pictureUnreadable"));
    }
    image::open(out.path()).map_err(|_| crate::errors::error("pictureUnreadable"))
}

#[cfg(not(target_os = "macos"))]
fn system_decode(_path: &Path) -> Result<DynamicImage, String> {
    Err(crate::errors::error("pictureFormat"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bmp(width: u32, height: u32) -> Vec<u8> {
        let mut bytes = Vec::new();
        DynamicImage::new_rgb8(width, height)
            .write_to(&mut Cursor::new(&mut bytes), ImageFormat::Bmp)
            .unwrap();
        bytes
    }

    #[test]
    fn a_bmp_is_sent_as_jpeg_and_a_huge_one_made_smaller() {
        let dir = std::env::temp_dir().join(format!("textus-picture-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("scan.bmp");
        std::fs::write(&path, bmp(4000, 1000)).unwrap();

        let sent = picture(&path, "bmp").unwrap();

        assert_eq!(sent.mime, "image/jpeg");
        let back = image::load_from_memory(&sent.bytes).unwrap();
        assert_eq!((back.width(), back.height()), (LONG_SIDE, 512));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_small_png_goes_as_it_is() {
        let dir = std::env::temp_dir().join(format!("textus-picture-png-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("dot.png");
        let mut bytes = Vec::new();
        DynamicImage::new_rgba8(4, 4)
            .write_to(&mut Cursor::new(&mut bytes), ImageFormat::Png)
            .unwrap();
        std::fs::write(&path, &bytes).unwrap();

        let sent = picture(&path, "png").unwrap();

        assert_eq!((sent.mime, sent.bytes), ("image/png", bytes));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
