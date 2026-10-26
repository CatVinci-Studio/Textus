//! EPUB to Markdown: the book's title and authors, then every chapter in
//! reading order through the HTML converter. A manifest href is tried both
//! percent-decoded and as written, since producers disagree.

use super::html::html_to_markdown;
use super::xml::{resolve_part, zip_entry, Node, Pull};
use std::path::Path;

pub(super) fn epub_markdown(path: &Path) -> Result<String, String> {
    let unreadable = || "This .epub is not a readable e-book.".to_string();
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(file).map_err(|_| unreadable())?;
    let container = zip_entry(&mut zip, "META-INF/container.xml").ok_or_else(unreadable)?;
    let opf_path = package_path(&container).ok_or_else(unreadable)?;
    let opf = zip_entry(&mut zip, &opf_path).ok_or_else(unreadable)?;
    let package = Package::parse(&opf);
    let base = opf_path
        .rsplit_once('/')
        .map(|(dir, _)| dir)
        .unwrap_or_default();

    let mut out = Vec::new();
    let mut about = Vec::new();
    if let Some(title) = &package.title {
        about.push(format!("**Title:** {title}"));
    }
    if !package.authors.is_empty() {
        about.push(format!("**Authors:** {}", package.authors.join(", ")));
    }
    if !about.is_empty() {
        out.push(about.join("\n"));
    }

    let mut chapters = 0;
    for id in &package.spine {
        let Some((_, href)) = package.manifest.iter().find(|(item, _)| item == id) else {
            continue;
        };
        let decoded = percent_decode(href);
        let chapter = [decoded.as_str(), href.as_str()]
            .iter()
            .find_map(|href| zip_entry(&mut zip, &resolve_part(base, href)));
        let Some(chapter) = chapter else {
            continue;
        };
        let markdown = html_to_markdown(&String::from_utf8_lossy(&chapter));
        if !markdown.is_empty() {
            out.push(markdown);
            chapters += 1;
        }
    }

    if chapters == 0 {
        return Err("This e-book has no text to read.".to_string());
    }
    Ok(out.join("\n\n"))
}

/// The `full-path` of the first `<rootfile>`.
fn package_path(container: &[u8]) -> Option<String> {
    let mut x = Pull::new(container);
    loop {
        match x.next() {
            Node::Open(tag) if tag.name == "rootfile" => {
                return tag.attr("full-path").map(str::to_string)
            }
            Node::End => return None,
            _ => {}
        }
    }
}

#[derive(Default)]
struct Package {
    title: Option<String>,
    authors: Vec<String>,
    /// (id, href)
    manifest: Vec<(String, String)>,
    /// Manifest ids in reading order.
    spine: Vec<String>,
}

impl Package {
    fn parse(opf: &[u8]) -> Self {
        let mut package = Self::default();
        let mut x = Pull::new(opf);
        loop {
            match x.next() {
                Node::Open(tag) => match tag.name.as_str() {
                    "title" if package.title.is_none() => {
                        let title = x.text().trim().to_string();
                        package.title = (!title.is_empty()).then_some(title);
                    }
                    "creator" => {
                        let author = x.text().trim().to_string();
                        if !author.is_empty() {
                            package.authors.push(author);
                        }
                    }
                    "item" => {
                        if let (Some(id), Some(href)) = (tag.attr("id"), tag.attr("href")) {
                            package.manifest.push((id.to_string(), href.to_string()));
                        }
                    }
                    "itemref" => {
                        if let Some(id) = tag.attr("idref") {
                            package.spine.push(id.to_string());
                        }
                    }
                    _ => {}
                },
                Node::End => return package,
                _ => {}
            }
        }
    }
}

/// `Chapter%201.xhtml` -> `Chapter 1.xhtml`; a malformed escape is kept as
/// written.
fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let hex = bytes
            .get(i + 1..i + 3)
            .and_then(|h| std::str::from_utf8(h).ok());
        match (bytes[i], hex.and_then(|h| u8::from_str_radix(h, 16).ok())) {
            (b'%', Some(byte)) => {
                out.push(byte);
                i += 3;
            }
            (byte, _) => {
                out.push(byte);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_epub(chapters: &[(&str, &str)]) -> Vec<u8> {
        use std::io::Write;
        let mut zip = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        let mut put = |name: &str, content: &str| {
            zip.start_file(name, options).unwrap();
            zip.write_all(content.as_bytes()).unwrap();
        };
        put("mimetype", "application/epub+zip");
        put(
            "META-INF/container.xml",
            r#"<container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>"#,
        );
        let manifest: String = chapters
            .iter()
            .enumerate()
            .map(|(i, (href, _))| {
                format!(r#"<item id="c{i}" href="{href}" media-type="application/xhtml+xml"/>"#)
            })
            .collect();
        // Reading order is the spine's, not the manifest's.
        let spine: String = (0..chapters.len())
            .rev()
            .map(|i| format!(r#"<itemref idref="c{i}"/>"#))
            .collect();
        put(
            "OEBPS/content.opf",
            &format!(
                r#"<package xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>A Book</dc:title><dc:creator>Ann</dc:creator><dc:creator>Bo</dc:creator></metadata><manifest>{manifest}</manifest><spine>{spine}</spine></package>"#
            ),
        );
        for (href, body) in chapters {
            put(
                &format!("OEBPS/{}", percent_decode(href)),
                &format!(
                    r#"<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>x</title></head><body>{body}</body></html>"#
                ),
            );
        }
        zip.finish().unwrap().into_inner()
    }

    #[test]
    fn chapters_are_read_in_spine_order_after_the_metadata() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("book.epub");
        let book = test_epub(&[
            (
                "text/Chapter%202.xhtml",
                "<h1>Two</h1><p>Later&nbsp;on.</p>",
            ),
            ("text/one.xhtml", "<h1>One</h1><p>It <i>began</i>.</p>"),
        ]);
        std::fs::write(&path, book).unwrap();
        assert_eq!(
            epub_markdown(&path).unwrap(),
            "**Title:** A Book\n**Authors:** Ann, Bo\n\n# One\n\nIt *began*.\n\n# Two\n\nLater\u{a0}on."
        );
    }

    #[test]
    fn a_zip_that_is_no_book_says_so() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("x.epub");
        std::fs::write(&path, b"not a zip").unwrap();
        assert_eq!(
            epub_markdown(&path).unwrap_err(),
            "This .epub is not a readable e-book."
        );
    }
}
