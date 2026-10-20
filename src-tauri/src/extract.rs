//! Text out of the formats a writer keeps next to their drafts that aren't
//! text files: PDF, Word, PowerPoint and spreadsheets. Two callers, one
//! extraction: chat attachments (commands/attachment.rs, the composer's "+")
//! and Textus AI's project tools (ai/project.rs), so a file reads the same
//! whether it was attached or found in the project folder.
//!
//! Every failure is a sentence meant for whoever reads it - the user on an
//! attachment chip, the model in a tool result - never a silent empty
//! string: "nothing extracted" and "the file is empty" must not look alike.

use std::io::Read;
use std::path::Path;

/// The formats extracted to text, as lowercase extensions - the arms of
/// `document_text`.
pub(crate) const DOCUMENT_EXTENSIONS: &[&str] =
    &["pdf", "docx", "pptx", "xlsx", "xlsm", "xlsb", "xls", "ods"];

/// Sanity bound on what is read off disk at all. Generous, because a 30 MB
/// spreadsheet can still extract to a few pages of text - what protects the
/// prompt is each caller's own cap on the extracted text.
pub(crate) const MAX_SOURCE_BYTES: u64 = 64 * 1024 * 1024;

/// Images ride to the provider as base64, which inflates by 4/3, and every
/// provider caps request size well below that. Reject early with a clear
/// message instead of failing deep inside an HTTP call.
pub(crate) const MAX_IMAGE_BYTES: u64 = 6 * 1024 * 1024;

/// How many rows of one spreadsheet sheet are rendered. Past this the sheet
/// is described rather than dumped - a 50k-row export is data, not reading
/// material.
const MAX_SHEET_ROWS: usize = 400;

/// Mime type for the image formats every vision-capable provider accepts.
/// Deliberately a closed list: an unrecognized extension is reported as
/// unsupported rather than guessed at and rejected by the provider later.
pub(crate) fn image_mime(ext: &str) -> Option<&'static str> {
    match ext {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        _ => None,
    }
}

/// The lowercase extension of `path` ("" without one).
pub(crate) fn extension_of(path: &Path) -> String {
    path.extension()
        .and_then(|e| e.to_str())
        .unwrap_or_default()
        .to_lowercase()
}

/// The text of a PDF, Word, PowerPoint or spreadsheet file, or why there is
/// none. None when `ext` (lowercase) is none of DOCUMENT_EXTENSIONS.
pub(crate) fn document_text(path: &Path, ext: &str) -> Option<Result<String, String>> {
    let text = match ext {
        "pdf" => pdf_text(path),
        "docx" => docx_text(path),
        "pptx" => pptx_text(path),
        "xlsx" | "xlsm" | "xlsb" | "xls" | "ods" => spreadsheet_text(path),
        _ => return None,
    };
    Some(text)
}

/// pdf-extract is known to panic on some malformed files rather than
/// returning Err. An attachment is read inside spawn_blocking, whose
/// JoinHandle would turn the unwind into an error, but a project tool runs
/// inside the agent loop, where the panic would end the whole request - so
/// it is caught here, for both.
fn pdf_text(path: &Path) -> Result<String, String> {
    let unreadable = || "This PDF can't be read.".to_string();
    let text = std::panic::catch_unwind(|| pdf_extract::extract_text(path))
        .map_err(|_| unreadable())?
        .map_err(|_| unreadable())?;
    if text.trim().is_empty() {
        return Err(
            "This PDF has no text layer - it's likely a scan, so there is nothing to read."
                .to_string(),
        );
    }
    Ok(tidy_lines(&text))
}

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

fn docx_text(path: &Path) -> Result<String, String> {
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

fn pptx_text(path: &Path) -> Result<String, String> {
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
fn spreadsheet_text(path: &Path) -> Result<String, String> {
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

/// A minimal .docx holding `paragraphs`, for tests that need a real Word
/// file on disk (here, ai/project.rs, the live eval).
#[cfg(test)]
pub(crate) fn test_docx(paragraphs: &[&str]) -> Vec<u8> {
    use std::io::Write;
    let body: String = paragraphs
        .iter()
        .map(|p| format!("<w:p><w:r><w:t>{p}</w:t></w:r></w:p>"))
        .collect();
    let xml = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>{body}</w:body></w:document>"#
    );
    let mut zip = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    let options =
        zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
    zip.start_file("word/document.xml", options).unwrap();
    zip.write_all(xml.as_bytes()).unwrap();
    zip.finish().unwrap().into_inner()
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
    fn blank_line_runs_collapse_to_one() {
        assert_eq!(tidy_lines("a\n\n\n\nb\n\n\n"), "a\n\nb");
    }

    #[test]
    fn documents_extract_to_text_and_failures_say_why() {
        let dir = tempfile::tempdir().unwrap();
        let docx = dir.path().join("notes.docx");
        std::fs::write(&docx, test_docx(&["First", "Second"])).unwrap();
        assert_eq!(
            document_text(&docx, "docx").unwrap().unwrap(),
            "First\nSecond"
        );
        let broken = dir.path().join("broken.pdf");
        std::fs::write(&broken, b"%PDF-1.4 not really").unwrap();
        assert_eq!(
            document_text(&broken, "pdf").unwrap().unwrap_err(),
            "This PDF can't be read."
        );
        assert!(document_text(&docx, "md").is_none());
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
