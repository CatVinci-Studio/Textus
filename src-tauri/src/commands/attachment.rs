use base64::Engine;
use serde::Serialize;
use std::io::Read;
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

/// Sanity bound on what is read off disk at all. Generous, because a 30 MB
/// spreadsheet can still extract to a few pages of text - the bound that
/// actually protects the prompt is MAX_EXTRACTED_CHARS below.
const MAX_SOURCE_BYTES: u64 = 64 * 1024 * 1024;

/// Images ride to the provider as base64, which inflates by 4/3, and every
/// provider caps request size well below that. Reject early with a clear
/// message instead of failing deep inside an HTTP call.
const MAX_IMAGE_BYTES: u64 = 6 * 1024 * 1024;

/// How much extracted text may enter the prompt. A 300-page PDF would
/// otherwise evict the document itself from the context window.
const MAX_EXTRACTED_CHARS: usize = 60_000;

/// How many rows of one spreadsheet sheet are rendered. Past this the sheet
/// is described rather than dumped - a 50k-row export is data, not reading
/// material, and the agent has read_file for the real thing.
const MAX_SHEET_ROWS: usize = 400;

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

fn extension_of(path: &Path) -> String {
    path.extension()
        .and_then(|e| e.to_str())
        .unwrap_or_default()
        .to_lowercase()
}

fn file_name_of(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string_lossy().to_string())
}

/// Formats whose text the project reader extracts too (ai::project): the
/// project folder's Word, PDF, slides and sheets are writing material as
/// much as its markdown.
pub(crate) const DOCUMENT_EXTENSIONS: &[&str] =
    &["pdf", "docx", "pptx", "xlsx", "xlsm", "xlsb", "xls", "ods"];

/// Pictures a document can show (the editor's formats, svg included).
pub(crate) fn is_image_extension(ext: &str) -> bool {
    image_mime(ext).is_some() || ext == "svg" || ext == "bmp" || ext == "avif"
}

/// The text of a PDF, Word, PowerPoint or spreadsheet file, capped like an
/// attachment's. A PDF the extractor panics on is reported, not fatal - the
/// agent's read_file runs this outside the picker's spawn_blocking guard.
pub(crate) fn document_text(path: &Path) -> Result<String, String> {
    let text = match extension_of(path).as_str() {
        "pdf" => {
            let owned = path.to_path_buf();
            let text = std::panic::catch_unwind(move || pdf_extract::extract_text(&owned))
                .ok()
                .and_then(Result::ok)
                .ok_or_else(|| "This PDF can't be read.".to_string())?;
            if text.trim().is_empty() {
                return Err(
                    "This PDF has no text layer - it's likely a scan, so there is nothing to read."
                        .to_string(),
                );
            }
            tidy_lines(&text)
        }
        "docx" => extract_docx(path)?,
        "pptx" => extract_pptx(path)?,
        _ => extract_spreadsheet(path)?,
    };
    if text.trim().is_empty() {
        return Err(format!("`{}` has no readable text.", file_name_of(path)));
    }
    Ok(cap_text(text).0)
}

/// Mime type for the image formats every vision-capable provider accepts.
/// Deliberately a closed list: an unrecognized extension is reported as
/// unsupported rather than guessed at and rejected by the provider later.
fn image_mime(ext: &str) -> Option<&'static str> {
    match ext {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        _ => None,
    }
}

/// Extensions the picker offers. The same list `extract` dispatches on, in
/// the same order, so adding a format is one edit - a second, hand-kept copy
/// in the dialog filter would silently stop offering formats the extractor
/// gained (or offer ones it never learned).
const SUPPORTED_EXTENSIONS: &[&str] = &[
    // Extracted to text
    "md", "markdown", "txt", "csv", "tsv", "json", "yaml", "yml", // Parsed to text
    "pdf", "docx", "pptx", "xlsx", "xlsm", "xlsb", "xls", "ods",
    // Sent as image parts (image_mime above)
    "png", "jpg", "jpeg", "gif", "webp",
];

// ---------------------------------------------------------------------------
// OOXML (docx, pptx)
// ---------------------------------------------------------------------------

/// Pulls the text runs out of one OOXML part.
///
/// docx and pptx are both a zip of XML: the visible words live in `<w:t>`
/// (Word) or `<a:t>` (PowerPoint) elements, and paragraph boundaries in
/// `<w:p>` / `<a:p>`. Walking that with a pull parser is a few dozen lines
/// and no format-specific dependency - which is why this is hand-rolled
/// rather than pulling in a crate like `dotext`, whose last release predates
/// the current zip/quick-xml ecosystem and would tie three formats to one
/// unmaintained package.
fn ooxml_part_text(xml: &[u8], text_tag: &str, para_tag: &str) -> String {
    use quick_xml::events::Event;
    use quick_xml::Reader;

    let mut reader = Reader::from_reader(xml);
    reader.config_mut().trim_text(false);
    let mut buf = Vec::new();
    let mut out = String::new();
    let mut in_text = false;

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                // `e.name()` borrows a temporary, so bind it before taking
                // the local part out of it.
                let qname = e.name();
                if local_name(qname.as_ref()) == text_tag {
                    in_text = true;
                }
            }
            Ok(Event::End(e)) => {
                let qname = e.name();
                let name = local_name(qname.as_ref());
                if name == text_tag {
                    in_text = false;
                } else if name == para_tag {
                    out.push('\n');
                }
            }
            Ok(Event::Empty(e)) => {
                // Word writes explicit breaks and tabs as empty elements;
                // without these a table row or a hard break would silently
                // fuse into the previous word.
                let qname = e.name();
                match local_name(qname.as_ref()) {
                    "br" | "cr" => out.push('\n'),
                    "tab" => out.push('\t'),
                    _ => {}
                }
            }
            Ok(Event::Text(e)) => {
                if in_text {
                    if let Ok(text) = e.decode() {
                        out.push_str(&text);
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
        buf.clear();
    }

    out
}

/// `w:t` -> `t`. OOXML names are namespace-prefixed, and the prefix is only
/// conventionally `w`/`a`, so match on the local part.
fn local_name(raw: &[u8]) -> &str {
    let name = std::str::from_utf8(raw).unwrap_or_default();
    name.rsplit(':').next().unwrap_or(name)
}

/// Collapses the runs of blank lines an OOXML part produces (every empty
/// paragraph contributes one) down to a readable paragraph break.
/// Written straight into one buffer rather than collected into a `Vec<&str>`
/// and joined. The input can be a multi-megabyte PDF dump, and the old shape
/// meant an index of every line plus a second full copy to join them - on top
/// of the copy the extractor already made.
fn tidy_lines(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut blank = false;
    for line in text.lines() {
        let trimmed = line.trim_end();
        if trimmed.trim().is_empty() {
            // Runs of empty paragraphs (every OOXML `<w:p>` contributes one)
            // collapse to a single blank line; leading ones are dropped.
            blank = !out.is_empty();
            continue;
        }
        if blank {
            out.push('\n');
            blank = false;
        }
        if !out.is_empty() {
            out.push('\n');
        }
        out.push_str(trimmed);
    }
    out
}

fn extract_docx(path: &Path) -> Result<String, String> {
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(file)
        .map_err(|_| "This .docx is not a readable Word file.".to_string())?;
    let mut xml = Vec::new();
    zip.by_name("word/document.xml")
        .map_err(|_| "This .docx has no document body.".to_string())?
        .read_to_end(&mut xml)
        .map_err(|e| e.to_string())?;
    Ok(tidy_lines(&ooxml_part_text(&xml, "t", "p")))
}

fn extract_pptx(path: &Path) -> Result<String, String> {
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(file)
        .map_err(|_| "This .pptx is not a readable PowerPoint file.".to_string())?;

    // Slides are `ppt/slides/slide1.xml`, `slide2.xml`, ... - which sort
    // wrong as strings (slide10 before slide2), so order by the number.
    let mut slides: Vec<(u32, String)> = zip
        .file_names()
        .filter_map(|name| {
            let rest = name.strip_prefix("ppt/slides/slide")?;
            let number = rest.strip_suffix(".xml")?.parse::<u32>().ok()?;
            Some((number, name.to_string()))
        })
        .collect();
    slides.sort();

    let mut out = String::new();
    for (number, name) in slides {
        let mut xml = Vec::new();
        let Ok(mut entry) = zip.by_name(&name) else {
            continue;
        };
        if entry.read_to_end(&mut xml).is_err() {
            continue;
        }
        let text = tidy_lines(&ooxml_part_text(&xml, "t", "p"));
        if text.trim().is_empty() {
            continue;
        }
        out.push_str(&format!("## Slide {number}\n\n{text}\n\n"));
    }

    if out.trim().is_empty() {
        return Err("This presentation has no extractable text.".to_string());
    }
    Ok(out.trim_end().to_string())
}

// ---------------------------------------------------------------------------
// Spreadsheets
// ---------------------------------------------------------------------------

/// Every sheet as a markdown table. Markdown rather than CSV because the rest
/// of the prompt - the document, every propose_edit argument - is markdown,
/// so the model reads one representation throughout.
fn extract_spreadsheet(path: &Path) -> Result<String, String> {
    use calamine::{open_workbook_auto, Reader};

    let mut workbook =
        open_workbook_auto(path).map_err(|_| "This spreadsheet can't be read.".to_string())?;
    let mut out = String::new();

    for name in workbook.sheet_names().to_owned() {
        let Ok(range) = workbook.worksheet_range(&name) else {
            continue;
        };
        if range.is_empty() {
            continue;
        }
        out.push_str(&format!("## {name}\n\n"));

        for (index, row) in range.rows().take(MAX_SHEET_ROWS).enumerate() {
            let cells: Vec<String> = row
                .iter()
                .map(|cell| cell.to_string().replace('|', "\\|").replace('\n', " "))
                .collect();
            out.push_str(&format!("| {} |\n", cells.join(" | ")));
            // Markdown needs the separator row after the header, and the
            // header is whatever the first row happens to be.
            if index == 0 {
                out.push_str(&format!("|{}|\n", " --- |".repeat(cells.len().max(1))));
            }
        }
        // Said out loud rather than just stopping: a silently halved sheet
        // reads as "the model saw my data" when it saw the top of it.
        if let Some(dropped) = range.height().checked_sub(MAX_SHEET_ROWS) {
            if dropped > 0 {
                out.push_str(&format!("\n[... {dropped} more rows not shown]\n"));
            }
        }
        out.push('\n');
    }

    if out.trim().is_empty() {
        return Err("This spreadsheet has no data.".to_string());
    }
    Ok(out.trim_end().to_string())
}

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

    let text = match ext.as_str() {
        "pdf" => {
            // pdf-extract is known to panic on some malformed files rather
            // than returning Err. This runs inside spawn_blocking, whose
            // JoinHandle turns an unwind into an Err - so a bad PDF surfaces
            // as a message on the chip instead of taking the app down.
            let text = pdf_extract::extract_text(path)
                .map_err(|_| "This PDF can't be read.".to_string())?;
            if text.trim().is_empty() {
                return Err(
                    "This PDF has no text layer - it's likely a scan, so there is nothing to read."
                        .to_string(),
                );
            }
            tidy_lines(&text)
        }
        "docx" => extract_docx(path)?,
        "pptx" => extract_pptx(path)?,
        "xlsx" | "xlsm" | "xlsb" | "xls" | "ods" => extract_spreadsheet(path)?,
        _ => std::fs::read_to_string(path).map_err(|_| {
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

    #[test]
    fn ooxml_text_runs_join_into_paragraphs() {
        let xml = br#"<w:document><w:body>
            <w:p><w:r><w:t>Hello</w:t></w:r><w:r><w:t> world</w:t></w:r></w:p>
            <w:p><w:r><w:t>Second</w:t></w:r></w:p>
        </w:body></w:document>"#;
        assert_eq!(
            tidy_lines(&ooxml_part_text(xml, "t", "p")),
            "Hello world\nSecond"
        );
    }

    #[test]
    fn ooxml_breaks_and_tabs_are_kept() {
        // Without the Empty-event branch these collapse into "abc", fusing
        // words that are visually on separate lines in Word.
        let xml = br#"<w:p><w:r><w:t>a</w:t><w:br/><w:t>b</w:t><w:tab/><w:t>c</w:t></w:r></w:p>"#;
        assert_eq!(ooxml_part_text(xml, "t", "p"), "a\nb\tc\n");
    }

    #[test]
    fn namespace_prefix_does_not_matter() {
        // The `w:`/`a:` prefixes are conventional, not guaranteed - matching
        // the full qualified name would silently extract nothing from a file
        // that binds the namespace to a different prefix.
        let xml = br#"<x:p><x:t>text</x:t></x:p>"#;
        assert_eq!(ooxml_part_text(xml, "t", "p"), "text\n");
    }

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

    #[test]
    fn blank_line_runs_collapse_to_one() {
        assert_eq!(tidy_lines("a\n\n\n\nb\n\n\n"), "a\n\nb");
    }

    /// The picker and the extractor must agree, or the dialog offers files
    /// `extract` will refuse (or hides ones it handles).
    #[test]
    fn every_offered_extension_is_one_the_extractor_handles() {
        const EXTRACTED: &[&str] = &["pdf", "docx", "pptx", "xlsx", "xlsm", "xlsb", "xls", "ods"];
        const AS_TEXT: &[&str] = &["md", "markdown", "txt", "csv", "tsv", "json", "yaml", "yml"];
        for ext in SUPPORTED_EXTENSIONS {
            assert!(
                image_mime(ext).is_some() || EXTRACTED.contains(ext) || AS_TEXT.contains(ext),
                "picker offers `{ext}` but extract() has no arm for it"
            );
        }
    }

    #[test]
    fn only_known_image_extensions_become_image_parts() {
        assert_eq!(image_mime("png"), Some("image/png"));
        assert_eq!(image_mime("jpeg"), Some("image/jpeg"));
        // Unrecognized: better reported as unsupported than guessed at and
        // rejected by the provider after a round trip.
        assert_eq!(image_mime("bmp"), None);
        assert_eq!(image_mime("svg"), None);
    }
}
