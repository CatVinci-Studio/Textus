//! The formats File › Export writes through pandoc: one list with the
//! frontend's (src/registry/export-formats.json), for the native menu and
//! `textus export`.

use serde::Deserialize;
use std::sync::LazyLock;

#[derive(Deserialize)]
pub struct PandocFormat {
    /// Pandoc's writer.
    pub format: String,
    /// Its files' extension.
    pub ext: String,
    /// The native menu's item, in English (the frontend sends it translated).
    pub menu: String,
}

static FORMATS: LazyLock<Vec<PandocFormat>> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../../src/registry/export-formats.json"))
        .expect("src/registry/export-formats.json is the formats' list")
});

pub fn pandoc_formats() -> &'static [PandocFormat] {
    &FORMATS
}

/// The extension a `textus export --to` format's file takes: PDF, HTML or
/// a pandoc writer's; None for one Textus doesn't write.
pub fn export_extension(format: &str) -> Option<&'static str> {
    match format {
        "pdf" => Some("pdf"),
        "html" => Some("html"),
        _ => FORMATS
            .iter()
            .find(|f| f.format == format)
            .map(|f| f.ext.as_str()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_format_has_its_extension() {
        assert!(pandoc_formats().len() >= 9);
        assert_eq!(export_extension("latex"), Some("tex"));
        assert_eq!(export_extension("pdf"), Some("pdf"));
        assert_eq!(export_extension("mobi"), None);
    }
}
