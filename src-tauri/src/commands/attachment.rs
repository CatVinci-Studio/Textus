use crate::extract::{document_text, extension_of, image_mime, MAX_IMAGE_BYTES, MAX_SOURCE_BYTES};
use base64::Engine;
use serde::Serialize;
use std::path::Path;

/// A chat attachment: whatever the user picked, turned into something a model
/// can actually read.
///
/// There are exactly two destinations, and every format has to reach one of
/// them - which is why this is a tagged union rather than one struct with a
/// `kind` string. The variants share only a name; as a flat struct every
/// constructor had to fill the other half with `String::new()`, and both
/// languages carried "empty for images" / "empty for text" comments enforcing
/// by convention what the type can enforce itself. Mirrored by
/// `ChatAttachment` in src/ai/types.ts, where `kind` narrows the union the
/// same way.
///
/// The old implementation was a plain `read_to_string`, so every binary -
/// a PDF above all - came back `Err`, and the frontend's `.catch(() => null)`
/// swallowed it. The button looked dead. Everything here therefore reports a
/// real reason on failure, and the caller shows it.
#[derive(Serialize, Clone)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ChatAttachment {
    Text {
        name: String,
        /// Extracted text, inlined into the prompt by the caller.
        content: String,
        /// `content` hit MAX_EXTRACTED_CHARS and was cut. The frontend labels
        /// the chip so the user knows the model isn't seeing the whole thing -
        /// a silent truncation reads as "the model has my file" when it
        /// doesn't.
        truncated: bool,
    },
    #[serde(rename_all = "camelCase")]
    Image {
        name: String,
        /// "image/png", ... - what the provider is told this is.
        mime: String,
        data_base64: String,
    },
}

impl ChatAttachment {
    fn text(name: String, content: String) -> Self {
        let (content, truncated) = cap_text(content);
        Self::Text {
            name,
            content,
            truncated,
        }
    }

    fn image(name: String, mime: &'static str, bytes: &[u8]) -> Self {
        Self::Image {
            name,
            mime: mime.to_string(),
            data_base64: base64::engine::general_purpose::STANDARD.encode(bytes),
        }
    }
}

/// How much extracted text may enter the prompt. A 300-page PDF would
/// otherwise evict the document itself from the context window.
const MAX_EXTRACTED_CHARS: usize = 60_000;

/// Cuts `text` to the cap, in place. `char_indices().nth()` stops as soon as
/// the cap is reached and hands back a byte index, so this costs O(cap)
/// rather than the two full UTF-8 walks a count-then-collect would - and the
/// input here can be a multi-megabyte PDF or spreadsheet dump. Truncating on
/// a char boundary (not a byte one) is what keeps CJK text from being cut
/// mid-character.
fn cap_text(mut text: String) -> (String, bool) {
    let Some((cut, _)) = text.char_indices().nth(MAX_EXTRACTED_CHARS) else {
        return (text, false);
    };
    text.truncate(cut);
    text.push_str("\n\n[... truncated: this file is longer than fits in one message]");
    (text, true)
}

fn file_name_of(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string_lossy().to_string())
}

/// Extensions the picker offers: the text formats, crate::extract's
/// DOCUMENT_EXTENSIONS and the image types, kept by hand - a test checks
/// that each one offered is one `extract` handles.
const SUPPORTED_EXTENSIONS: &[&str] = &[
    // Extracted to text
    "md", "markdown", "txt", "csv", "tsv", "json", "yaml", "yml",
    // Converted to Markdown (crate::extract)
    "pdf", "docx", "pptx", "xlsx", "xlsm", "xlsb", "xls", "ods", "epub", "rtf", "html", "htm",
    "xhtml", // Sent as image parts (crate::extract::image_mime)
    "png", "jpg", "jpeg", "gif", "webp",
];

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/// Reads and converts one already-picked file. Split from the picker so the
/// size check, the dialog's format list and the extraction all sit on one
/// side of a single `spawn_blocking`, and so `bytes` (already known from the
/// one `stat` the caller does) doesn't have to be looked up a second time.
fn extract(path: &Path, bytes: u64) -> Result<ChatAttachment, String> {
    let name = file_name_of(path);
    let ext = extension_of(path);

    if let Some(mime) = image_mime(&ext) {
        if bytes > MAX_IMAGE_BYTES {
            return Err(format!(
                "That image is too large to send ({} MB; the limit is {} MB).",
                bytes / (1024 * 1024),
                MAX_IMAGE_BYTES / (1024 * 1024)
            ));
        }
        let data = std::fs::read(path).map_err(|e| e.to_string())?;
        return Ok(ChatAttachment::image(name, mime, &data));
    }

    let text = match document_text(path, &ext) {
        Some(text) => text?,
        None => std::fs::read_to_string(path).map_err(|_| {
            format!("`{name}` isn't a text file, and Textus can't read this format yet.")
        })?,
    };

    if text.trim().is_empty() {
        return Err(format!("`{name}` has no readable text."));
    }
    Ok(ChatAttachment::text(name, text))
}

/// Turns a path the user picked into an attachment.
///
/// Errors are messages meant for the user - a silent failure here is
/// indistinguishable from a dead button, which is exactly how the old
/// text-only version behaved on a PDF.
///
/// Not a command: exposed, it let the webview read any path on disk, while
/// the only caller is the picker below, reading a path the user just chose.
async fn read_attachment_file(path: String) -> Result<ChatAttachment, String> {
    // One blocking hop for the whole read: the size check is a `stat`, which
    // is not free on a network volume or a sleeping external disk, and doing
    // it out here parked an async worker thread for it.
    tauri::async_runtime::spawn_blocking(move || {
        let path = Path::new(&path);
        let bytes = std::fs::metadata(path).map_err(|e| e.to_string())?.len();
        if bytes > MAX_SOURCE_BYTES {
            return Err(format!(
                "That file is too large to attach ({} MB; the limit is {} MB).",
                bytes / (1024 * 1024),
                MAX_SOURCE_BYTES / (1024 * 1024)
            ));
        }
        extract(path, bytes)
    })
    .await
    .map_err(|_| "Reading that file failed.".to_string())?
}

/// The chat composer's "+" button: pick a file, then read it. Returns None
/// only when the picker was cancelled.
#[tauri::command]
pub async fn pick_attachment_file(
    window: tauri::WebviewWindow,
) -> Result<Option<ChatAttachment>, String> {
    let picked = tauri::async_runtime::spawn_blocking(move || {
        super::fs::window_file_dialog(&window)
            .add_filter("Documents, spreadsheets and images", SUPPORTED_EXTENSIONS)
            .blocking_pick_file()
    })
    .await
    .map_err(|e| e.to_string())?;
    let Some(path) = picked.map(|p| p.to_string()) else {
        return Ok(None);
    };
    read_attachment_file(path).await.map(Some)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::extract::DOCUMENT_EXTENSIONS;

    #[test]
    fn truncation_is_marked_not_silent() {
        let long = "x".repeat(MAX_EXTRACTED_CHARS + 10);
        let ChatAttachment::Text {
            content, truncated, ..
        } = ChatAttachment::text("big.txt".to_string(), long)
        else {
            panic!("text() must produce a Text attachment");
        };
        assert!(truncated);
        assert!(content.contains("truncated"));
    }

    #[test]
    fn text_under_the_cap_is_untouched() {
        let ChatAttachment::Text {
            content, truncated, ..
        } = ChatAttachment::text("small.txt".to_string(), "hello".to_string())
        else {
            panic!("text() must produce a Text attachment");
        };
        assert!(!truncated);
        assert_eq!(content, "hello");
    }

    /// The picker and the extractor must agree, or the dialog offers files
    /// `extract` will refuse (or hides ones it handles).
    #[test]
    fn every_offered_extension_is_one_the_extractor_handles() {
        const AS_TEXT: &[&str] = &["md", "markdown", "txt", "csv", "tsv", "json", "yaml", "yml"];
        for ext in SUPPORTED_EXTENSIONS {
            assert!(
                image_mime(ext).is_some()
                    || DOCUMENT_EXTENSIONS.contains(ext)
                    || AS_TEXT.contains(ext),
                "picker offers `{ext}` but extract() has no arm for it"
            );
        }
    }
}
