use super::*;

/// A .pptx of `slides` (each the inside of `<p:spTree>`) with optional
/// extra parts.
fn test_pptx(slides: &[&str], parts: &[(&str, &str)]) -> Vec<u8> {
    use std::io::Write;
    let mut zip = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    let options =
        zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
    for (i, tree) in slides.iter().enumerate() {
        zip.start_file(format!("ppt/slides/slide{}.xml", i + 1), options)
            .unwrap();
        let xml = format!(
            r#"<p:sld xmlns:p="p" xmlns:a="a" xmlns:r="r"><p:cSld><p:spTree>{tree}</p:spTree></p:cSld></p:sld>"#
        );
        zip.write_all(xml.as_bytes()).unwrap();
    }
    for (name, content) in parts {
        zip.start_file(*name, options).unwrap();
        zip.write_all(content.as_bytes()).unwrap();
    }
    zip.finish().unwrap().into_inner()
}

fn convert(slides: &[&str], parts: &[(&str, &str)]) -> Result<String, String> {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("t.pptx");
    std::fs::write(&path, test_pptx(slides, parts)).unwrap();
    pptx_markdown(&path)
}

fn sp(ph: &str, y: i64, paragraphs: &str) -> String {
    format!(
        r#"<p:sp><p:nvSpPr><p:nvPr>{ph}</p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="{y}"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/>{paragraphs}</p:txBody></p:sp>"#
    )
}

fn para(text: &str) -> String {
    format!("<a:p><a:r><a:t>{text}</a:t></a:r></a:p>")
}

#[test]
fn slides_get_their_title_body_list_and_notes() {
    let body = format!(
        "{}{}{}",
        para("Why"),
        r#"<a:p><a:pPr lvl="1"/><a:r><a:rPr b="1"/><a:t>Because</a:t></a:r></a:p>"#,
        r#"<a:p><a:pPr><a:buNone/></a:pPr><a:r><a:t>Aside</a:t></a:r></a:p>"#
    );
    // In the file the body comes first, the footer is template
    // furniture, and the text box sits below the body on the slide.
    let slide = [
        sp(r#"<p:ph idx="1"/>"#, 100, &body),
        sp("", 900, &para("A text box")),
        sp(r#"<p:ph type="sldNum"/>"#, 999, &para("7")),
        sp(r#"<p:ph type="title"/>"#, 0, &para("The plan")),
    ]
    .concat();
    let notes = sp(r#"<p:ph type="body" idx="1"/>"#, 0, &para("Say it slowly."));
    let notes_slide = format!(
        r#"<p:notes xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>{notes}</p:spTree></p:cSld></p:notes>"#
    );
    let parts = [
        (
            "ppt/slides/_rels/slide1.xml.rels",
            r#"<Relationships><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/></Relationships>"#,
        ),
        ("ppt/notesSlides/notesSlide1.xml", notes_slide.as_str()),
    ];
    assert_eq!(
            convert(&[&slide], &parts).unwrap(),
            "## Slide 1: The plan\n\n- Why\n    - **Because**\n\nAside\n\nA text box\n\n### Notes\n\nSay it slowly."
        );
}

#[test]
fn tables_pictures_and_groups_are_read_in_place() {
    let cell = |t: &str| format!("<a:tc><a:txBody>{}</a:txBody><a:tcPr/></a:tc>", para(t));
    let table = format!(
        r#"<p:graphicFrame><p:xfrm><a:off x="0" y="500"/></p:xfrm><a:graphic><a:graphicData><a:tbl><a:tblGrid/><a:tr>{}{}</a:tr><a:tr>{}{}</a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>"#,
        cell("Q"),
        cell("Sales"),
        cell("Q1"),
        cell("12")
    );
    let picture = r#"<p:pic><p:nvPicPr><p:cNvPr id="4" name="Picture 3" descr="Sales chart"/></p:nvPicPr><p:blipFill><a:blip r:embed="rId3"/></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="200"/></a:xfrm></p:spPr></p:pic>"#;
    let group = format!(
        r#"<p:grpSp><p:nvGrpSpPr/><p:grpSpPr><a:xfrm><a:off x="0" y="100"/></a:xfrm></p:grpSpPr>{}{}</p:grpSp>"#,
        sp("", 20, &para("second in group")),
        sp("", 10, &para("first in group"))
    );
    let slide = [table, picture.to_string(), group].concat();
    let rels = (
        "ppt/slides/_rels/slide1.xml.rels",
        r#"<Relationships><Relationship Id="rId3" Type="image" Target="../media/image3.png"/></Relationships>"#,
    );
    assert_eq!(
            convert(&[&slide], &[rels]).unwrap(),
            "## Slide 1\n\nfirst in group\n\nsecond in group\n\n![Sales chart](image3.png)\n\n| Q | Sales |\n| --- | --- |\n| Q1 | 12 |"
        );
}

#[test]
fn slides_are_numbered_by_file_and_empty_ones_dropped() {
    let empty = String::new();
    let titled = sp(
        r#"<p:ph type="ctrTitle"/>"#,
        0,
        &para("Hello &amp; welcome"),
    );
    let mut slides = vec![empty.as_str(); 9];
    slides.push(&titled);
    assert_eq!(
        convert(&slides, &[]).unwrap(),
        "## Slide 10: Hello & welcome"
    );
    assert_eq!(
        convert(&[&empty], &[]).unwrap_err(),
        "This presentation has no extractable text."
    );
}
