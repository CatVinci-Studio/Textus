//! Markdown from the non-text formats a writer keeps: PDF, Word, PowerPoint,
//! spreadsheets, EPUB, RTF and HTML, shared by attachments and the AI's tools.
//! Rules ported from MarkItDown (MIT); failures are always a readable sentence.

mod docx;
mod epub;
mod html;
mod markdown;
mod pptx;
mod rtf;
mod xml;

use std::path::Path;

/// Also for anything holding a web page, such as a fetch tool.
pub(crate) use html::html_to_markdown;

pub(crate) use docx::docx_document;

/// The formats converted to Markdown, as lowercase extensions (the arms of
/// `document_text`).
pub(crate) const DOCUMENT_EXTENSIONS: &[&str] = &[
    "pdf", "docx", "pptx", "xlsx", "xlsm", "xlsb", "xls", "ods", "epub", "rtf", "html", "htm",
    "xhtml",
];

/// Sanity bound on what is read off disk. Generous: each caller caps the
/// extracted text itself.
pub(crate) const MAX_SOURCE_BYTES: u64 = 64 * 1024 * 1024;

/// Images go to the provider as base64 (4/3 larger) and providers cap request
/// size, so reject early with a clear message.
pub(crate) const MAX_IMAGE_BYTES: u64 = 6 * 1024 * 1024;

/// How many rows of one sheet are rendered; past this the sheet is described,
/// not dumped.
const MAX_SHEET_ROWS: usize = 400;

/// Mime type for the image formats every vision-capable provider accepts. A
/// closed list: anything else is reported as unsupported.
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

/// The Markdown of a document in one of DOCUMENT_EXTENSIONS, or why there
/// is none. None when `ext` (lowercase) is none of them.
pub(crate) fn document_text(path: &Path, ext: &str) -> Option<Result<String, String>> {
    let text = match ext {
        "pdf" => pdf_text(path),
        "docx" => docx::docx_markdown(path),
        "pptx" => pptx::pptx_markdown(path),
        "xlsx" | "xlsm" | "xlsb" | "xls" | "ods" => spreadsheet_text(path),
        "epub" => epub::epub_markdown(path),
        "rtf" => rtf::rtf_markdown(path),
        "html" | "htm" | "xhtml" => std::fs::read(path)
            .map(|bytes| html_to_markdown(&String::from_utf8_lossy(&bytes)))
            .map_err(|e| e.to_string()),
        _ => return None,
    };
    Some(text)
}

/// pdf-extract can panic on malformed files, which would end the agent's whole
/// request, so the panic is caught here. The text keeps pdf-extract's layout;
/// guessing headings from font sizes would misfire.
fn pdf_text(path: &Path) -> Result<String, String> {
    pdf_text_with(|| pdf_extract::extract_text(path))
}

/// The text of a PDF held in memory.
pub(crate) fn pdf_text_from_bytes(bytes: &[u8]) -> Result<String, String> {
    pdf_text_with(|| pdf_extract::extract_text_from_mem(bytes))
}

fn pdf_text_with(
    extract: impl FnOnce() -> Result<String, pdf_extract::OutputError> + std::panic::UnwindSafe,
) -> Result<String, String> {
    let unreadable = || "This PDF can't be read.".to_string();
    let text = std::panic::catch_unwind(extract)
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

/// Collapses the runs of blank lines a PDF's text layer produces into
/// paragraph breaks, in one buffer since the input can be megabytes.
fn tidy_lines(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut blank = false;
    for line in text.lines() {
        let trimmed = line.trim_end();
        if trimmed.trim().is_empty() {
            // Runs of empty lines collapse to a single blank line; leading
            // ones are dropped.
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


/// Every sheet as a Markdown table under its name: the rest of the prompt is
/// Markdown, so the model reads one representation.
fn spreadsheet_text(path: &Path) -> Result<String, String> {
    use calamine::{open_workbook_auto, Reader};

    let mut workbook =
        open_workbook_auto(path).map_err(|_| "This spreadsheet can't be read.".to_string())?;
    let mut out = String::new();

    for name in workbook.sheet_names().to_owned() {
        let Ok(range) = workbook.worksheet_range(&name) else {
            continue;
        };
        // Empty rows carry nothing in a Markdown table, and a sheet whose
        // first row is blank would otherwise get a blank header.
        let mut rows = range
            .rows()
            .map(|row| row.iter().map(cell_text).collect::<Vec<_>>())
            .filter(|row| row.iter().any(|cell| !cell.trim().is_empty()));
        let shown: Vec<Vec<String>> = rows.by_ref().take(MAX_SHEET_ROWS).collect();
        if shown.is_empty() {
            continue;
        }
        out.push_str(&format!("## {name}\n\n"));
        out.push_str(&markdown::table(&shown));
        out.push('\n');
        // Said out loud: a silently cut sheet reads as "the model saw my data".
        let dropped = rows.count();
        if dropped > 0 {
            out.push_str(&format!("\n[... {dropped} more rows not shown]\n"));
        }
        out.push('\n');
    }

    if out.trim().is_empty() {
        return Err("This spreadsheet has no data.".to_string());
    }
    Ok(out.trim_end().to_string())
}

/// A cell as it reads. A date stored as a day count (`45943.5`) is written as
/// the date it is.
fn cell_text(cell: &calamine::Data) -> String {
    match cell {
        calamine::Data::DateTime(date) if date.is_datetime() => {
            let (y, m, d, h, min, s, _) = date.to_ymd_hms_milli();
            if (h, min, s) == (0, 0, 0) {
                format!("{y:04}-{m:02}-{d:02}")
            } else {
                format!("{y:04}-{m:02}-{d:02} {h:02}:{min:02}:{s:02}")
            }
        }
        cell => cell.to_string(),
    }
}

/// A minimal .docx holding `paragraphs`, for tests that need a real Word file
/// on disk.
#[cfg(test)]
pub(crate) use docx::test_docx_with;

#[cfg(test)]
pub(crate) fn test_docx(paragraphs: &[&str]) -> Vec<u8> {
    let body: String = paragraphs
        .iter()
        .map(|p| format!("<w:p><w:r><w:t>{p}</w:t></w:r></w:p>"))
        .collect();
    docx::test_docx_with(&body, &[])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blank_line_runs_collapse_to_one() {
        assert_eq!(tidy_lines("a\n\n\n\nb\n\n\n"), "a\n\nb");
    }

    #[test]
    fn documents_extract_to_markdown_and_failures_say_why() {
        let dir = tempfile::tempdir().unwrap();
        let docx = dir.path().join("notes.docx");
        std::fs::write(&docx, test_docx(&["First", "Second"])).unwrap();
        assert_eq!(
            document_text(&docx, "docx").unwrap().unwrap(),
            "First\n\nSecond"
        );
        let broken = dir.path().join("broken.pdf");
        std::fs::write(&broken, b"%PDF-1.4 not really").unwrap();
        assert_eq!(
            document_text(&broken, "pdf").unwrap().unwrap_err(),
            "This PDF can't be read."
        );
        let page = dir.path().join("page.html");
        std::fs::write(&page, "<h2>Notes</h2><p>From <b>the</b> web.</p>").unwrap();
        assert_eq!(
            document_text(&page, "html").unwrap().unwrap(),
            "## Notes\n\nFrom **the** web."
        );
        assert!(document_text(&docx, "md").is_none());
    }

    #[test]
    fn every_document_extension_has_an_arm() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("empty");
        std::fs::write(&path, b"").unwrap();
        for ext in DOCUMENT_EXTENSIONS {
            assert!(document_text(&path, ext).is_some(), "no arm for `{ext}`");
        }
    }

    #[test]
    fn sheets_become_tables_with_dates_as_dates() {
        use calamine::{Data, ExcelDateTime, ExcelDateTimeType};
        let date = |v| Data::DateTime(ExcelDateTime::new(v, ExcelDateTimeType::DateTime, false));
        assert_eq!(cell_text(&date(45943.0)), "2025-10-13");
        assert_eq!(cell_text(&date(45943.5)), "2025-10-13 12:00:00");
        assert_eq!(cell_text(&Data::Float(3.5)), "3.5");
    }

    #[test]
    fn an_ods_sheet_reads_as_a_table_with_its_name() {
        // ODS is the one spreadsheet format simple enough to write by hand:
        // a zip with a mimetype and content.xml.
        use std::io::Write;
        let rows: String = std::iter::once(("Name", "Words".to_string()))
            .chain(std::iter::once(("", String::new())))
            .chain((1..=(MAX_SHEET_ROWS + 2)).map(|i| ("Ch", i.to_string())))
            .map(|(a, b)| {
                format!(
                    "<table:table-row><table:table-cell office:value-type=\"string\"><text:p>{a}</text:p></table:table-cell><table:table-cell office:value-type=\"string\"><text:p>{b}</text:p></table:table-cell></table:table-row>"
                )
            })
            .collect();
        let content = format!(
            r#"<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.2"><office:body><office:spreadsheet><table:table table:name="Draft | counts">{rows}</table:table></office:spreadsheet></office:body></office:document-content>"#
        );
        let mut zip = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        zip.start_file("mimetype", options).unwrap();
        zip.write_all(b"application/vnd.oasis.opendocument.spreadsheet")
            .unwrap();
        zip.start_file("META-INF/manifest.xml", options).unwrap();
        zip.write_all(br#"<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"/>"#).unwrap();
        zip.start_file("content.xml", options).unwrap();
        zip.write_all(content.as_bytes()).unwrap();
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("counts.ods");
        std::fs::write(&path, zip.finish().unwrap().into_inner()).unwrap();

        let text = document_text(&path, "ods").unwrap().unwrap();
        assert!(
            text.starts_with("## Draft | counts\n\n| Name | Words |\n| --- | --- |\n| Ch | 1 |\n"),
            "{text}"
        );
        // The blank row is dropped, not counted; the header counts as a row.
        let last = MAX_SHEET_ROWS - 1;
        assert!(
            text.ends_with(&format!("| Ch | {last} |\n\n[... 3 more rows not shown]")),
            "{text}"
        );
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
