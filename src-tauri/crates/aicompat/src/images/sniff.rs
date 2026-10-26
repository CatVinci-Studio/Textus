//! What a generated image really is, read from its bytes rather than the
//! provider's word for it. Only PNG, JPEG and WebP pass, so an SVG or an HTML
//! error page never reaches the document; the size comes from the header.

/// The largest image accepted, encoded. The biggest picture any of these
/// services makes (4096 x 4096 PNG) stays well under it.
pub const MAX_IMAGE_BYTES: usize = 20 * 1024 * 1024;

/// A recognised image: its MIME type, the file extension it is saved under,
/// and its size in pixels.
#[derive(Debug, PartialEq, Eq)]
pub struct Sniffed {
    pub mime: &'static str,
    pub ext: &'static str,
    pub width: u32,
    pub height: u32,
}

pub fn sniff(bytes: &[u8]) -> Option<Sniffed> {
    if bytes.len() > MAX_IMAGE_BYTES {
        return None;
    }
    let (mime, ext, (width, height)) = if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        ("image/png", "png", png_size(bytes)?)
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        ("image/jpeg", "jpg", jpeg_size(bytes)?)
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        ("image/webp", "webp", webp_size(bytes)?)
    } else {
        return None;
    };
    (width > 0 && height > 0).then_some(Sniffed {
        mime,
        ext,
        width,
        height,
    })
}

fn be32(b: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_be_bytes(b.get(at..at + 4)?.try_into().ok()?))
}

fn be16(b: &[u8], at: usize) -> Option<u32> {
    Some(u16::from_be_bytes(b.get(at..at + 2)?.try_into().ok()?) as u32)
}

fn le16(b: &[u8], at: usize) -> Option<u32> {
    Some(u16::from_le_bytes(b.get(at..at + 2)?.try_into().ok()?) as u32)
}

fn le24(b: &[u8], at: usize) -> Option<u32> {
    let s = b.get(at..at + 3)?;
    Some(s[0] as u32 | (s[1] as u32) << 8 | (s[2] as u32) << 16)
}

/// The IHDR chunk, which PNG requires first.
fn png_size(b: &[u8]) -> Option<(u32, u32)> {
    (b.get(12..16)? == b"IHDR").then_some(())?;
    Some((be32(b, 16)?, be32(b, 20)?))
}

/// The first start-of-frame segment. Markers C4 (Huffman tables), C8 and
/// CC (arithmetic coding) share the SOF range without being frames.
fn jpeg_size(b: &[u8]) -> Option<(u32, u32)> {
    let mut at = 2;
    while at + 4 <= b.len() {
        if b[at] != 0xff {
            return None;
        }
        let marker = b[at + 1];
        // Fill bytes before a marker.
        if marker == 0xff {
            at += 1;
            continue;
        }
        let length = be16(b, at + 2)? as usize;
        if (0xc0..=0xcf).contains(&marker) && !matches!(marker, 0xc4 | 0xc8 | 0xcc) {
            return Some((be16(b, at + 7)?, be16(b, at + 5)?));
        }
        at += 2 + length;
    }
    None
}

/// Lossy (VP8), lossless (VP8L) or extended (VP8X) - the first chunk names
/// which, and each keeps the size in its own place.
fn webp_size(b: &[u8]) -> Option<(u32, u32)> {
    match b.get(12..16)? {
        b"VP8 " => {
            // After the frame tag and the 9d 01 2a start code; 14 bits each.
            (b.get(23..26)? == [0x9d, 0x01, 0x2a]).then_some(())?;
            Some((le16(b, 26)? & 0x3fff, le16(b, 28)? & 0x3fff))
        }
        b"VP8L" => {
            (*b.get(20)? == 0x2f).then_some(())?;
            let bits = u32::from_le_bytes(b.get(21..25)?.try_into().ok()?);
            Some(((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1))
        }
        b"VP8X" => Some((le24(b, 24)? + 1, le24(b, 27)? + 1)),
        _ => None,
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// A 2 x 3 PNG: the signature and IHDR are all `sniff` reads.
    pub(crate) fn png(width: u32, height: u32) -> Vec<u8> {
        let mut b = b"\x89PNG\r\n\x1a\n\0\0\0\x0dIHDR".to_vec();
        b.extend(width.to_be_bytes());
        b.extend(height.to_be_bytes());
        b.extend([8, 6, 0, 0, 0, 0, 0, 0, 0]);
        b
    }

    #[test]
    fn png_jpeg_and_webp_are_read_from_their_headers() {
        assert_eq!(
            sniff(&png(2, 3)),
            Some(Sniffed {
                mime: "image/png",
                ext: "png",
                width: 2,
                height: 3
            })
        );
        // SOI, an APP0 segment, then SOF0 with height 0x0300, width 0x0400.
        let mut jpeg = vec![0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0];
        jpeg.extend([0xff, 0xc0, 0, 11, 8, 0x03, 0x00, 0x04, 0x00, 3]);
        let got = sniff(&jpeg).unwrap();
        assert_eq!((got.ext, got.width, got.height), ("jpg", 1024, 768));
        let mut webp = b"RIFF\0\0\0\0WEBPVP8X\x0a\0\0\0\0\0\0\0".to_vec();
        webp.extend([0xff, 0x03, 0x00, 0xff, 0x02, 0x00]);
        let got = sniff(&webp).unwrap();
        assert_eq!((got.mime, got.width, got.height), ("image/webp", 1024, 768));
    }

    #[test]
    fn anything_else_is_not_an_image() {
        assert_eq!(sniff(b"<svg xmlns='http://www.w3.org/2000/svg'/>"), None);
        assert_eq!(sniff(b"<!doctype html><title>404</title>"), None);
        assert_eq!(sniff(b""), None);
        // Cut off before the size.
        assert_eq!(sniff(&png(2, 3)[..18]), None);
        assert_eq!(sniff(&png(0, 3)), None);
    }
}
