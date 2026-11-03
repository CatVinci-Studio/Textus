//! Files attached to a chat: copied into the conversation's scratch folder
//! (`attached/`, see ai::scratch), where the agent's file tools read them,
//! and turned into what the message carries - text, or a picture.

mod archive;
mod picture;

use crate::ai::scratch::{self, ATTACHED};
use crate::extract::{document_text, extension_of, MAX_SOURCE_BYTES};
use base64::Engine;
use serde::Serialize;
use std::path::{Path, PathBuf};

/// A chat attachment: whatever the user picked, turned into something a model
/// can read. Failures carry a real reason for the user to see.
#[derive(Serialize, Clone)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ChatAttachment {
    Text {
        name: String,
        /// Extracted text, inlined into the prompt by the caller.
        content: String,
        /// `content` hit MAX_EXTRACTED_CHARS and was cut; the frontend labels the chip
        /// so the user knows the model isn't seeing the whole file.
        truncated: bool,
        /// Where read_file finds the whole file: `attached/<name>`.
        path: String,
    },
    #[serde(rename_all = "camelCase")]
    Image {
        name: String,
        /// "image/png", ... - what the provider is told this is.
        mime: String,
        data_base64: String,
        path: String,
    },
}

impl ChatAttachment {
    fn text(name: String, content: String, path: String) -> Self {
        let (content, truncated) = cap_text(content);
        Self::Text {
            name,
            content,
            truncated,
            path,
        }
    }

    fn image(name: String, mime: &'static str, bytes: &[u8], path: String) -> Self {
        Self::Image {
            name,
            mime: mime.to_string(),
            data_base64: base64::engine::general_purpose::STANDARD.encode(bytes),
            path,
        }
    }
}

/// How much extracted text may enter the prompt. A 300-page PDF would
/// otherwise evict the document itself from the context window.
const MAX_EXTRACTED_CHARS: usize = 60_000;

/// Cuts `text` to the cap, in place, on a char boundary so CJK text isn't cut
/// mid-character. O(cap), since the input can be a multi-megabyte dump.
fn cap_text(mut text: String) -> (String, bool) {
    let Some((cut, _)) = text.char_indices().nth(MAX_EXTRACTED_CHARS) else {
        return (text, false);
    };
    text.truncate(cut);
    text.push_str(
        "\n\n[... truncated: the whole file is at the path above - read_file reads the rest]",
    );
    (text, true)
}

fn file_name_of(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string_lossy().to_string())
}

/// The kinds the picker lists first; any other file can be attached too and
/// is read as text when it is text.
const SUPPORTED_EXTENSIONS: &[&str] = &[
    "md", "markdown", "txt", "csv", "tsv", "json", "yaml", "yml", "svg", "pdf", "docx", "pptx",
    "xlsx", "xlsm", "xlsb", "xls", "ods", "epub", "rtf", "html", "htm", "xhtml", "zip", "png",
    "jpg", "jpeg", "gif", "webp", "bmp", "tif", "tiff", "ico", "heic", "heif", "avif",
];

/// A free name for `name` in `dir`: `report.pdf`, then `report (2).pdf`.
fn free_name(dir: &Path, name: &str) -> String {
    if !dir.join(name).exists() {
        return name.to_string();
    }
    let (stem, ext) = match name.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() => (stem, format!(".{ext}")),
        _ => (name, String::new()),
    };
    (2..)
        .map(|n| format!("{stem} ({n}){ext}"))
        .find(|candidate| !dir.join(candidate).exists())
        .unwrap_or_default()
}

/// Copies one picked file into `attached` and reads it, all inside one
/// `spawn_blocking`.
fn stage(source: &Path, attached: &Path) -> Result<ChatAttachment, String> {
    let bytes = std::fs::metadata(source).map_err(|e| e.to_string())?.len();
    if bytes > MAX_SOURCE_BYTES {
        return Err(format!(
            "That file is too large to attach ({} MB; the limit is {} MB).",
            bytes / (1024 * 1024),
            MAX_SOURCE_BYTES / (1024 * 1024)
        ));
    }
    let name = free_name(attached, &file_name_of(source));
    let copy = attached.join(&name);
    std::fs::copy(source, &copy).map_err(|e| e.to_string())?;
    let path = format!("{ATTACHED}/{name}");
    let ext = extension_of(&copy);

    if picture::PICTURE_EXTENSIONS.contains(&ext.as_str()) {
        let sent = picture::picture(&copy, &ext)?;
        return Ok(ChatAttachment::image(name, sent.mime, &sent.bytes, path));
    }
    if ext == "zip" {
        let folder = free_name(attached, name.trim_end_matches(".zip"));
        let files = archive::unpack(&copy, &attached.join(&folder))?;
        let listing = files
            .iter()
            .map(|f| format!("- {ATTACHED}/{folder}/{f}"))
            .collect::<Vec<_>>()
            .join("\n");
        let content = format!(
            "A zip archive, unpacked to `{ATTACHED}/{folder}/` ({} files) - read_file reads each:\n{listing}",
            files.len()
        );
        return Ok(ChatAttachment::text(name, content, path));
    }

    let text = match document_text(&copy, &ext) {
        Some(text) => text?,
        None => std::fs::read_to_string(&copy).map_err(|_| {
            format!("`{name}` isn't a text file, and Textus can't read this format yet.")
        })?,
    };
    if text.trim().is_empty() {
        return Err(format!("`{name}` has no readable text."));
    }
    Ok(ChatAttachment::text(name, text, path))
}

/// The chat composer's "+" button: pick files, then copy and read each into
/// the conversation's attachments. Empty when the picker was cancelled; a
/// file that can't be read fails the whole pick, naming it.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn pick_attachment_files(
    window: tauri::WebviewWindow,
    conversation: String,
) -> Result<Vec<ChatAttachment>, String> {
    let picked = tauri::async_runtime::spawn_blocking(move || {
        super::fs::window_file_dialog(&window)
            .add_filter("Documents, archives and pictures", SUPPORTED_EXTENSIONS)
            .add_filter("All files", &["*"])
            .blocking_pick_files()
    })
    .await
    .map_err(|e| e.to_string())?;
    let Some(paths) = picked else {
        return Ok(Vec::new());
    };
    let paths: Vec<PathBuf> = paths
        .into_iter()
        .filter_map(|p| p.into_path().ok())
        .collect();
    tauri::async_runtime::spawn_blocking(move || {
        let attached = scratch::attached_dir(&conversation)?;
        paths.iter().map(|p| stage(p, &attached)).collect()
    })
    .await
    .map_err(|_| "Reading that file failed.".to_string())?
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
        } = ChatAttachment::text("big.txt".to_string(), long, String::new())
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
        } = ChatAttachment::text("small.txt".to_string(), "hello".to_string(), String::new())
        else {
            panic!("text() must produce a Text attachment");
        };
        assert!(!truncated);
        assert_eq!(content, "hello");
    }

    /// The picker and the reader must agree, or the dialog offers files
    /// `stage` will refuse.
    #[test]
    fn every_offered_extension_is_one_the_reader_handles() {
        const AS_TEXT: &[&str] = &[
            "md", "markdown", "txt", "csv", "tsv", "json", "yaml", "yml", "svg", "zip",
        ];
        for ext in SUPPORTED_EXTENSIONS {
            assert!(
                picture::PICTURE_EXTENSIONS.contains(ext)
                    || DOCUMENT_EXTENSIONS.contains(ext)
                    || AS_TEXT.contains(ext),
                "picker offers `{ext}` but stage() has no arm for it"
            );
        }
    }

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("textus-stage-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("attached")).unwrap();
        dir
    }

    #[test]
    fn code_is_attached_as_text_and_kept_whole_under_attached() {
        let dir = scratch("code");
        let source = dir.join("main.py");
        std::fs::write(&source, "print('hi')\n").unwrap();

        let ChatAttachment::Text { content, path, .. } =
            stage(&source, &dir.join("attached")).unwrap()
        else {
            panic!("a .py file is text");
        };

        assert_eq!(
            (content.as_str(), path.as_str()),
            ("print('hi')\n", "attached/main.py")
        );
        // The same name twice keeps both.
        let ChatAttachment::Text { path, .. } = stage(&source, &dir.join("attached")).unwrap()
        else {
            panic!();
        };
        assert_eq!(path, "attached/main (2).py");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_zip_is_unpacked_and_listed() {
        use std::io::Write;
        let dir = scratch("zip");
        let source = dir.join("notes.zip");
        let mut zip = zip::ZipWriter::new(std::fs::File::create(&source).unwrap());
        zip.start_file("ch1.md", zip::write::SimpleFileOptions::default())
            .unwrap();
        zip.write_all(b"# One").unwrap();
        zip.finish().unwrap();

        let ChatAttachment::Text { content, .. } = stage(&source, &dir.join("attached")).unwrap()
        else {
            panic!("a zip is listed as text");
        };

        assert!(content.contains("attached/notes/ch1.md"), "{content}");
        assert!(dir.join("attached/notes/ch1.md").is_file());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
