//! A picture's size read from its file's header, before the page loads it:
//! the document takes the picture's room at once, so nothing below moves
//! when it arrives.

use image::metadata::Orientation;
use image::{ImageDecoder, ImageReader};

#[cfg_attr(test, derive(specta::Type))]
#[derive(serde::Serialize, Debug, PartialEq)]
pub struct PictureSize {
    pub width: u32,
    pub height: u32,
}

/// The size `path` shows at, turned as its EXIF says (as the page shows a
/// photo); None for what can't be read this way (SVG, a missing file).
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn picture_size(path: String) -> Option<PictureSize> {
    tauri::async_runtime::spawn_blocking(move || size_of(&path))
        .await
        .ok()
        .flatten()
}

fn size_of(path: &str) -> Option<PictureSize> {
    let mut decoder = ImageReader::open(path)
        .ok()?
        .with_guessed_format()
        .ok()?
        .into_decoder()
        .ok()?;
    let (width, height) = decoder.dimensions();
    let turned = matches!(
        decoder.orientation().unwrap_or(Orientation::NoTransforms),
        Orientation::Rotate90
            | Orientation::Rotate270
            | Orientation::Rotate90FlipH
            | Orientation::Rotate270FlipH
    );
    let (width, height) = if turned { (height, width) } else { (width, height) };
    (width > 0 && height > 0).then_some(PictureSize { width, height })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_picture_s_size_is_read_from_its_header() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("p.png");
        image::RgbImage::new(30, 20).save(&path).unwrap();
        assert_eq!(
            size_of(path.to_str().unwrap()),
            Some(PictureSize { width: 30, height: 20 })
        );
        let svg = dir.path().join("p.svg");
        std::fs::write(&svg, "<svg xmlns='http://www.w3.org/2000/svg'/>").unwrap();
        assert_eq!(size_of(svg.to_str().unwrap()), None);
        assert_eq!(size_of(dir.path().join("none.png").to_str().unwrap()), None);
    }
}
