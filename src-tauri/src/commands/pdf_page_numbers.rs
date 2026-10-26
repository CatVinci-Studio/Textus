//! Page numbers for PDF export, stamped onto the finished file: no CSS route
//! numbers pages on every webview, but every export ends with an empty ~20mm
//! bottom margin to draw in.

use std::path::Path;

use lopdf::{dictionary, Dictionary, Document, Object, ObjectId, Stream};

/// The resource name the number's font goes under on each page - unusual
/// enough not to collide with a renderer's own /F1, /TT2, ...
const FONT_NAME: &[u8] = b"TextusPageNo";
/// Small, like a book's folio.
const FONT_SIZE: f32 = 9.0;
/// The baseline above the sheet's bottom edge: ~10mm, the middle of the ~20mm
/// bottom margin every platform leaves.
const BASELINE: f32 = 28.0;
/// Neutral grey, legible on white paper and on the macOS export's themed
/// page colour alike.
const GREY: f32 = 0.5;
/// Every digit in Helvetica is 556/1000 em wide, so a number is centred
/// from its length alone.
const DIGIT_WIDTH: f32 = 0.556;

/// Numbers every page of the PDF at `path` in place (write-then-rename, so
/// a failure leaves the unnumbered export intact).
pub fn number_pdf_file(path: &Path) -> Result<(), String> {
    let pdf = std::fs::read(path).map_err(|e| e.to_string())?;
    let numbered = number_pages(&pdf)?;
    crate::atomic::write_sync(path, numbered).map_err(|e| e.to_string())
}

/// `pdf` with each page's number, from 1, centred in its bottom margin.
pub fn number_pages(pdf: &[u8]) -> Result<Vec<u8>, String> {
    let mut doc = Document::load_mem(pdf).map_err(|e| format!("Could not read the PDF: {e}"))?;
    // Helvetica is one of the PDF standard fonts every reader has, so
    // nothing is embedded; WinAnsi covers the digits.
    let font = doc.add_object(dictionary! {
        "Type" => "Font",
        "Subtype" => "Type1",
        "BaseFont" => "Helvetica",
        "Encoding" => "WinAnsiEncoding",
    });
    // The renderer's content goes between these, so whatever graphics state it
    // leaves behind can't move or tint the number.
    let save = doc.add_object(Stream::new(Dictionary::new(), b"q\n".to_vec()));
    for (number, page) in doc.get_pages() {
        let [x0, y0, x1, _] = page_box(&doc, page)?;
        let label = number.to_string();
        let width = DIGIT_WIDTH * FONT_SIZE * label.len() as f32;
        let x = (x0 + x1 - width) / 2.0;
        let y = y0 + BASELINE;
        let stamp = format!(
            "Q\nq\nBT\n/{} {FONT_SIZE} Tf\n{GREY} g\n1 0 0 1 {x:.2} {y:.2} Tm\n({label}) Tj\nET\nQ\n",
            String::from_utf8_lossy(FONT_NAME),
        );
        let stamp = doc.add_object(Stream::new(Dictionary::new(), stamp.into_bytes()));
        let resources = page_resources(&doc, page, font);

        let page_dict = doc
            .get_dictionary_mut(page)
            .map_err(|e| format!("Bad PDF page: {e}"))?;
        let mut contents = vec![Object::Reference(save)];
        match page_dict.get(b"Contents") {
            Ok(Object::Array(parts)) => contents.extend(parts.iter().cloned()),
            Ok(part) => contents.push(part.clone()),
            Err(_) => {}
        }
        contents.push(Object::Reference(stamp));
        page_dict.set("Contents", Object::Array(contents));
        page_dict.set("Resources", resources);
    }
    let mut out = Vec::with_capacity(pdf.len() + 4096);
    doc.save_to(&mut out)
        .map_err(|e| format!("Could not write the PDF: {e}"))?;
    Ok(out)
}

/// A page attribute, looked up the page tree the way a reader does:
/// Resources, MediaBox and CropBox may sit on any ancestor Pages node.
fn inherited<'a>(doc: &'a Document, page: ObjectId, key: &[u8]) -> Option<&'a Object> {
    let mut node = doc.get_dictionary(page).ok()?;
    // Bounded: a malformed tree could loop.
    for _ in 0..64 {
        if let Ok(value) = node.get(key) {
            return doc.dereference(value).ok().map(|(_, value)| value);
        }
        let parent = node.get(b"Parent").and_then(Object::as_reference).ok()?;
        node = doc.get_dictionary(parent).ok()?;
    }
    None
}

/// The visible area of a page: its crop box, else its media box. On macOS these
/// don't start at 0,0 (each sheet is a window onto one tall render).
fn page_box(doc: &Document, page: ObjectId) -> Result<[f32; 4], String> {
    let rect = inherited(doc, page, b"CropBox")
        .or_else(|| inherited(doc, page, b"MediaBox"))
        .and_then(|value| value.as_array().ok())
        .ok_or("PDF page has no size")?;
    let mut corners = [0.0; 4];
    for (corner, value) in corners.iter_mut().zip(rect) {
        *corner = doc
            .dereference(value)
            .and_then(|(_, value)| value.as_float())
            .map_err(|_| "PDF page size is not a number")?;
    }
    let [a, b, c, d] = corners;
    Ok([a.min(c), b.min(d), a.max(c), b.max(d)])
}

/// The page's resources with the number's font added, as a copy, so resources
/// shared with other pages are left as they were.
fn page_resources(doc: &Document, page: ObjectId, font: ObjectId) -> Dictionary {
    let mut resources = match inherited(doc, page, b"Resources") {
        Some(Object::Dictionary(dict)) => dict.clone(),
        _ => Dictionary::new(),
    };
    let mut fonts = match resources.get(b"Font").map(|value| doc.dereference(value)) {
        Ok(Ok((_, Object::Dictionary(dict)))) => dict.clone(),
        _ => Dictionary::new(),
    };
    fonts.set(FONT_NAME, Object::Reference(font));
    resources.set("Font", fonts);
    resources
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A plain `pages`-page PDF in the shape a renderer writes: shared,
    /// inherited resources and media box on the Pages node, one text line
    /// per page (`Body N`), and `origin` as the media box's corner.
    fn fixture(pages: usize, origin: (i64, i64)) -> Vec<u8> {
        let mut doc = Document::with_version("1.5");
        let tree = doc.new_object_id();
        let body_font = doc.add_object(dictionary! {
            "Type" => "Font",
            "Subtype" => "Type1",
            "BaseFont" => "Times-Roman",
        });
        let resources = doc.add_object(dictionary! {
            "Font" => dictionary! { "F1" => body_font },
        });
        let (ox, oy) = origin;
        let mut kids = Vec::new();
        for i in 1..=pages {
            // A transform left unbalanced on purpose, as some renderers
            // leave one: the number must not inherit it.
            let text = format!(
                "2 0 0 2 0 0 cm\nBT /F1 12 Tf {} {} Td (Body {i}) Tj ET\n",
                ox + 30,
                oy + 300
            );
            let content = doc.add_object(Stream::new(Dictionary::new(), text.into_bytes()));
            kids.push(Object::Reference(doc.add_object(dictionary! {
                "Type" => "Page",
                "Parent" => tree,
                "Contents" => content,
            })));
        }
        doc.objects.insert(
            tree,
            Object::Dictionary(dictionary! {
                "Type" => "Pages",
                "Kids" => kids,
                "Count" => pages as i64,
                "Resources" => resources,
                "MediaBox" => vec![ox.into(), oy.into(), (ox + 595).into(), (oy + 842).into()],
            }),
        );
        let catalog = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => tree });
        doc.trailer.set("Root", catalog);
        let mut out = Vec::new();
        doc.save_to(&mut out).unwrap();
        out
    }

    fn page_texts(pdf: &[u8]) -> Vec<String> {
        let doc = Document::load_mem(pdf).unwrap();
        doc.get_pages()
            .values()
            .map(|&page| String::from_utf8_lossy(&doc.get_page_content(page).unwrap()).into_owned())
            .collect()
    }

    #[test]
    fn every_page_gets_its_own_number_after_its_content() {
        let numbered = number_pages(&fixture(3, (0, 0))).unwrap();
        let texts = page_texts(&numbered);
        assert_eq!(texts.len(), 3);
        for (i, text) in texts.iter().enumerate() {
            let n = i + 1;
            let body = text.find(&format!("(Body {n}) Tj")).unwrap();
            let number = text.find(&format!("({n}) Tj")).unwrap();
            assert!(number > body, "page {n}: {text}");
            // Restored to the page's own state before drawing.
            assert!(text.starts_with("q\n"), "page {n}: {text}");
            assert!(text[body..].contains("Q\nq\nBT\n/TextusPageNo 9 Tf"));
        }
    }

    #[test]
    fn the_number_is_centred_in_the_bottom_margin() {
        let texts = page_texts(&number_pages(&fixture(12, (0, 0))).unwrap());
        // 595pt wide; "1" is 5.004pt wide at 9pt, "12" twice that.
        assert!(texts[0].contains("1 0 0 1 295.00 28.00 Tm"), "{}", texts[0]);
        assert!(
            texts[11].contains("1 0 0 1 292.50 28.00 Tm"),
            "{}",
            texts[11]
        );
    }

    #[test]
    fn a_sheet_cut_from_a_taller_render_is_numbered_inside_its_own_box() {
        // macOS: each sheet's media box is a window onto one tall page.
        let texts = page_texts(&number_pages(&fixture(2, (0, -1684))).unwrap());
        assert!(
            texts[0].contains("1 0 0 1 295.00 -1656.00 Tm"),
            "{}",
            texts[0]
        );
    }

    #[test]
    fn shared_resources_are_copied_not_changed() {
        let numbered = number_pages(&fixture(2, (0, 0))).unwrap();
        let doc = Document::load_mem(&numbered).unwrap();
        for page in doc.get_pages().values() {
            let fonts = doc.get_page_fonts(*page).unwrap();
            assert!(fonts.contains_key(b"F1".as_slice()));
            assert_eq!(
                fonts[FONT_NAME]
                    .get(b"BaseFont")
                    .unwrap()
                    .as_name()
                    .unwrap(),
                b"Helvetica"
            );
        }
        // The Pages node's own (inherited) dictionary has no page number font.
        let root = doc
            .catalog()
            .unwrap()
            .get(b"Pages")
            .unwrap()
            .as_reference()
            .unwrap();
        let shared = doc.get_dictionary(root).unwrap().get(b"Resources").unwrap();
        let shared = doc.dereference(shared).unwrap().1.as_dict().unwrap();
        let fonts = doc.dereference(shared.get(b"Font").unwrap()).unwrap().1;
        assert!(fonts.as_dict().unwrap().get(FONT_NAME).is_err());
    }

    #[test]
    fn text_extraction_finds_the_page_numbers() {
        let numbered = number_pages(&fixture(3, (0, 0))).unwrap();
        let pages = pdf_extract::extract_text_from_mem_by_pages(&numbered).unwrap();
        assert_eq!(pages.len(), 3);
        for (i, page) in pages.iter().enumerate() {
            let n = (i + 1).to_string();
            assert!(page.contains(&format!("Body {n}")), "{page}");
            assert!(page.split_whitespace().any(|word| word == n), "{page}");
        }
    }

    #[test]
    fn a_file_that_is_not_a_pdf_is_an_error() {
        assert!(number_pages(b"not a pdf").is_err());
    }
}
