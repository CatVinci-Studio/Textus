//! Pandoc writes an ODT table's cells with no border at all: its own cell
//! styles say `fo:border="none"`, and a reference document can't reach them,
//! so LibreOffice shows a table as loose text (#827). After Pandoc, those two
//! styles get a thin line, as a Word export's table has.

use std::io::{Read, Write};
use std::path::Path;

/// Pandoc's cell styles: a header row's and the others'.
const CELL_STYLES: [&str; 2] = ["TableHeaderRowCell", "TableRowCell"];
const BORDER: &str = r#"fo:border="0.5pt solid #808080" fo:padding="0.04in""#;

/// `content` (an ODT's content.xml) with Pandoc's cells given a line.
pub(super) fn with_cell_borders(content: &str) -> String {
    let mut out = content.to_string();
    for name in CELL_STYLES {
        let head = format!(r#"style:name="{name}" style:family="table-cell""#);
        let Some(at) = out.find(&head) else { continue };
        let Some(len) = out[at..].find("</style:style>") else {
            continue;
        };
        let block = out[at..at + len].replace(r#"fo:border="none""#, BORDER);
        out.replace_range(at..at + len, &block);
    }
    out
}

/// Rewrites the ODT at `path` with its table cells lined; its other entries
/// are copied as they are (the uncompressed mimetype first, as ODF wants).
pub(super) fn line_table_cells(path: &Path) -> std::io::Result<()> {
    let mut archive =
        zip::ZipArchive::new(std::fs::File::open(path)?).map_err(std::io::Error::other)?;
    let part = path.with_extension("odt-part");
    let written = (|| -> std::io::Result<()> {
        let mut writer = zip::ZipWriter::new(std::fs::File::create(&part)?);
        for i in 0..archive.len() {
            let mut entry = archive.by_index(i).map_err(std::io::Error::other)?;
            let name = entry.name().map_err(std::io::Error::other)?.to_string();
            if name != "content.xml" {
                writer.raw_copy_file(entry).map_err(std::io::Error::other)?;
                continue;
            }
            let mut text = String::new();
            entry.read_to_string(&mut text)?;
            let options = zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Deflated);
            writer
                .start_file("content.xml", options)
                .map_err(std::io::Error::other)?;
            writer.write_all(with_cell_borders(&text).as_bytes())?;
        }
        writer.finish().map_err(std::io::Error::other)?;
        Ok(())
    })();
    match written {
        Ok(()) => std::fs::rename(&part, path),
        Err(e) => {
            let _ = std::fs::remove_file(&part);
            Err(e)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PANDOC: &str = r#"<office:automatic-styles>
    <style:style style:name="TableHeaderRowCell" style:family="table-cell">
      <style:table-cell-properties fo:border="none" />
    </style:style>
    <style:style style:name="TableRowCell" style:family="table-cell">
      <style:table-cell-properties fo:border="none" />
    </style:style>
    <style:style style:name="Other" style:family="paragraph">
      <style:paragraph-properties fo:border="none" />
    </style:style>"#;

    #[test]
    fn pandoc_cells_get_a_line_and_nothing_else_changes() {
        let out = with_cell_borders(PANDOC);
        assert_eq!(out.matches("0.5pt solid").count(), 2);
        // A paragraph style that says none keeps it.
        assert!(out.contains(r#"<style:paragraph-properties fo:border="none" />"#));
    }

    #[test]
    fn the_file_keeps_its_entries_and_mimetype_first() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("t.odt");
        {
            let mut zip = zip::ZipWriter::new(std::fs::File::create(&path).unwrap());
            let stored = zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Stored);
            zip.start_file("mimetype", stored).unwrap();
            zip.write_all(b"application/vnd.oasis.opendocument.text")
                .unwrap();
            zip.start_file("content.xml", zip::write::SimpleFileOptions::default())
                .unwrap();
            zip.write_all(PANDOC.as_bytes()).unwrap();
            zip.start_file("styles.xml", zip::write::SimpleFileOptions::default())
                .unwrap();
            zip.write_all(b"<styles/>").unwrap();
            zip.finish().unwrap();
        }
        line_table_cells(&path).unwrap();
        let mut archive = zip::ZipArchive::new(std::fs::File::open(&path).unwrap()).unwrap();
        let names: Vec<String> = (0..archive.len())
            .map(|i| archive.by_index(i).unwrap().name().unwrap().to_string())
            .collect();
        assert_eq!(names, ["mimetype", "content.xml", "styles.xml"]);
        assert_eq!(
            archive.by_index(0).unwrap().compression(),
            zip::CompressionMethod::Stored
        );
        let mut content = String::new();
        archive
            .by_name("content.xml")
            .unwrap()
            .read_to_string(&mut content)
            .unwrap();
        assert_eq!(content.matches("0.5pt solid").count(), 2);
    }
}
