//! A folder's documents the window read itself (an Android folder opened
//! without access to all files), read for their metadata as any other.

use super::{blocks_of, parse_document, DocumentMeta};
use serde::Deserialize;

/// A document's place and text, as the window read it.
#[derive(Deserialize)]
#[cfg_attr(test, derive(specta::Type))]
pub struct DocumentText {
    pub path: String,
    pub rel: String,
    pub text: String,
}

/// Each document's metadata; with `blocks`, its blocks too.
pub(crate) fn of_texts(documents: &[DocumentText], blocks: bool) -> Vec<DocumentMeta> {
    documents
        .iter()
        .map(|d| {
            let mut meta = parse_document(&d.path, &d.rel, &d.text);
            if blocks {
                meta.blocks = Some(blocks_of(&d.text));
            }
            meta
        })
        .collect()
}

/// Reads no file: the window hands the texts in.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn plugin_metadata_of_texts(documents: Vec<DocumentText>, blocks: bool) -> Vec<DocumentMeta> {
    of_texts(&documents, blocks)
}
