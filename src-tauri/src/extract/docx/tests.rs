use super::*;

fn convert(body: &str, parts: &[(&str, &str)]) -> String {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("t.docx");
    std::fs::write(&path, test_docx_with(body, parts)).unwrap();
    docx_markdown(&path).unwrap()
}

fn p(style: &str, text: &str) -> String {
    format!(r#"<w:p><w:pPr><w:pStyle w:val="{style}"/></w:pPr><w:r><w:t>{text}</w:t></w:r></w:p>"#)
}

const STYLES: (&str, &str) = (
    "word/styles.xml",
    r#"<w:styles {W}>
            <w:style w:styleId="Titel"><w:name w:val="Title"/></w:style>
            <w:style w:styleId="berschrift1"><w:name w:val="heading 1"/></w:style>
            <w:style w:styleId="Chapter"><w:name w:val="Chapter"/><w:basedOn w:val="berschrift2"/></w:style>
            <w:style w:styleId="berschrift2"><w:name w:val="heading 2"/></w:style>
            <w:style w:styleId="ListBullet"><w:name w:val="List Bullet"/><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr></w:style>
            <w:style w:styleId="Strong"><w:name w:val="Strong"/></w:style>
            <w:style w:styleId="Author"><w:name w:val="Author"/><w:basedOn w:val="Titel"/></w:style>
            <w:style w:styleId="Zitat"><w:name w:val="Quote"/></w:style>
        </w:styles>"#,
);

#[test]
fn heading_styles_become_headings_by_name_not_id() {
    // German Word's ids ("berschrift1") with the English built-in names
    // Word stores whatever its language; "Chapter" is based on heading 2.
    let body = [
            p("Titel", "Book"),
            p("Author", "Ann"),
            p("berschrift1", "Part one"),
            r#"<w:p><w:pPr><w:pStyle w:val="Chapter"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>A chapter</w:t></w:r></w:p>"#.to_string(),
            p("Zitat", "Quoted."),
            p("Normal", "Text."),
        ]
        .concat();
    // pandoc's "Author" is based on "Title" and is no heading; a bold
    // heading is just a heading.
    assert_eq!(
        convert(&body, &[STYLES]),
        "# Book\n\nAnn\n\n# Part one\n\n## A chapter\n\n> Quoted.\n\nText."
    );
}

#[test]
fn lists_are_numbered_or_bulleted_as_the_numbering_part_says() {
    let numbering = (
        "word/numbering.xml",
        r#"<w:numbering {W}>
                <w:abstractNum w:abstractNumId="5"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl><w:lvl w:ilvl="1"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum>
                <w:abstractNum w:abstractNumId="6"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum>
                <w:num w:numId="1"><w:abstractNumId w:val="6"/></w:num>
                <w:num w:numId="2"><w:abstractNumId w:val="5"/></w:num>
            </w:numbering>"#,
    );
    let item = |ilvl: u8, num: u8, text: &str| {
        format!(
            r#"<w:p><w:pPr><w:numPr><w:ilvl w:val="{ilvl}"/><w:numId w:val="{num}"/></w:numPr></w:pPr><w:r><w:t>{text}</w:t></w:r></w:p>"#
        )
    };
    let body = [
        item(0, 2, "First"),
        item(1, 2, "Detail"),
        item(0, 2, "Second"),
        p("Normal", "Between."),
        p("ListBullet", "Styled bullet"),
    ]
    .concat();
    assert_eq!(
        convert(&body, &[STYLES, numbering]),
        "1. First\n    - Detail\n2. Second\n\nBetween.\n\n- Styled bullet"
    );
}

#[test]
fn emphasis_links_and_breaks_survive() {
    let rels = (
        "word/_rels/document.xml.rels",
        r#"<Relationships><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/" TargetMode="External"/></Relationships>"#,
    );
    let body = r#"<w:p>
            <w:r><w:t xml:space="preserve">Plain </w:t></w:r>
            <w:r><w:rPr><w:b/></w:rPr><w:t>bo</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>ld</w:t></w:r>
            <w:r><w:rPr><w:b w:val="0"/><w:i/></w:rPr><w:t xml:space="preserve"> italic</w:t></w:r>
            <w:r><w:rPr><w:rStyle w:val="Strong"/></w:rPr><w:t xml:space="preserve"> strong</w:t></w:r>
            <w:r><w:t xml:space="preserve"> and </w:t></w:r>
            <w:hyperlink r:id="rId9"><w:r><w:t>a link</w:t></w:r></w:hyperlink>
            <w:r><w:br/><w:t>Tom &amp; Jerry</w:t></w:r>
            <w:del><w:r><w:delText>gone</w:delText></w:r></w:del>
        </w:p>"#;
    assert_eq!(
        convert(body, &[STYLES, rels]),
        "Plain **bold** *italic* **strong** and [a link](https://example.com/)\nTom & Jerry"
    );
}

#[test]
fn tables_become_pipe_tables() {
    let cell = |text: &str| format!("<w:tc><w:p><w:r><w:t>{text}</w:t></w:r></w:p></w:tc>");
    let body = format!(
        r#"<w:tbl><w:tblPr/><w:tblGrid/>
                <w:tr>{}{}</w:tr>
                <w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>wide</w:t></w:r></w:p><w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr>
                <w:tr>{}{}</w:tr>
            </w:tbl>"#,
        cell("Name"),
        cell("Age"),
        cell("Ann"),
        cell("41")
    );
    assert_eq!(
        convert(&body, &[]),
        "| Name | Age |\n| --- | --- |\n| wide<br>cell |  |\n| Ann | 41 |"
    );
}

#[test]
fn footnotes_are_numbered_by_first_reference_and_listed_at_the_end() {
    let notes = (
        "word/footnotes.xml",
        r#"<w:footnotes {W}>
                <w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>
                <w:footnote w:id="1"><w:p><w:r><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> Smith, 1999.</w:t></w:r></w:p></w:footnote>
                <w:footnote w:id="2"><w:p><w:r><w:t>Ibid.</w:t></w:r></w:p></w:footnote>
            </w:footnotes>"#,
    );
    let body = r#"<w:p><w:r><w:t>Claim</w:t></w:r><w:r><w:footnoteReference w:id="2"/></w:r><w:r><w:t xml:space="preserve"> and another</w:t></w:r><w:r><w:footnoteReference w:id="1"/></w:r><w:r><w:t>.</w:t></w:r></w:p>"#;
    assert_eq!(
        convert(body, &[notes]),
        "Claim[^1] and another[^2].\n\n[^1]: Ibid.\n\n[^2]: Smith, 1999."
    );
}

#[test]
fn images_keep_their_alt_text_and_drawings_are_read_once() {
    let rels = (
        "word/_rels/document.xml.rels",
        r#"<Relationships><Relationship Id="rId4" Type="image" Target="media/image1.png"/></Relationships>"#,
    );
    let body = r#"<w:p><w:r><mc:AlternateContent xmlns:mc="mc">
            <mc:Choice><w:drawing><wp:inline xmlns:wp="wp"><wp:docPr id="1" name="Picture 1" descr="A [red] barn"/>
                <a:graphic xmlns:a="a"><a:graphicData><pic:pic xmlns:pic="pic"><pic:blipFill><a:blip r:embed="rId4"/></pic:blipFill></pic:pic></a:graphicData></a:graphic>
            </wp:inline></w:drawing></mc:Choice>
            <mc:Fallback><w:pict><v:imagedata xmlns:v="v" r:id="rId4"/></w:pict></mc:Fallback>
        </mc:AlternateContent></w:r></w:p>"#;
    assert_eq!(convert(body, &[rels]), "![A red barn](media/image1.png)");
}

#[test]
fn numbered_items_show_the_number_word_shows() {
    // Level 0 starts at 5; numId 3 is "Restart at 1" on the same list.
    let numbering = (
        "word/numbering.xml",
        r#"<w:numbering {W}>
                <w:abstractNum w:abstractNumId="0">
                    <w:lvl w:ilvl="0"><w:start w:val="5"/><w:numFmt w:val="decimal"/></w:lvl>
                    <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/></w:lvl>
                </w:abstractNum>
                <w:num w:numId="2"><w:abstractNumId w:val="0"/></w:num>
                <w:num w:numId="3"><w:abstractNumId w:val="0"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>
            </w:numbering>"#,
    );
    let item = |ilvl: u8, num: u8, text: &str| {
        format!(
            r#"<w:p><w:pPr><w:numPr><w:ilvl w:val="{ilvl}"/><w:numId w:val="{num}"/></w:numPr></w:pPr><w:r><w:t>{text}</w:t></w:r></w:p>"#
        )
    };
    let body = [
        item(0, 2, "Five"),
        item(1, 2, "a"),
        item(1, 2, "b"),
        item(0, 2, "Six"),
        item(1, 2, "a again"),
        p("Normal", "Between."),
        item(0, 2, "Seven, after the paragraph"),
        item(0, 3, "Restarted"),
        item(0, 3, "Two"),
    ]
    .concat();
    assert_eq!(
        convert(&body, &[numbering]),
        "5. Five\n    1. a\n    2. b\n6. Six\n    1. a again\n\nBetween.\n\n\
             7. Seven, after the paragraph\n1. Restarted\n2. Two"
    );
}

/// `body` opened as a document, with the pictures it saved: (name in
/// the file, bytes).
fn open(body: &str, parts: &[(&str, &str)]) -> (String, Vec<(String, Vec<u8>)>) {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("t.docx");
    std::fs::write(&path, test_docx_with(body, parts)).unwrap();
    let mut saved = Vec::new();
    let markdown = docx_document(&path, &mut |name, bytes| {
        saved.push((name.to_string(), bytes.to_vec()));
        Some(format!("/drafts/image-{}.png", saved.len()))
    })
    .unwrap();
    (markdown, saved)
}

/// `text` as the runs of one paragraph: a `\n` is a line break.
fn runs(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .split('\n')
        .map(|line| format!(r#"<w:r><w:t xml:space="preserve">{line}</w:t></w:r>"#))
        .collect::<Vec<_>>()
        .join("<w:r><w:br/></w:r>")
}

/// Each block's text as a CommonMark reader reads `markdown` back:
/// paragraphs, headings, list items, table cells and footnote
/// definitions, a hard break as `\n`. Anything read as markup is named.
fn read_back(markdown: &str) -> Vec<String> {
    use pulldown_cmark::{Event, Options, Parser, Tag, TagEnd};
    let options = Options::ENABLE_TABLES
        | Options::ENABLE_FOOTNOTES
        | Options::ENABLE_STRIKETHROUGH
        | Options::ENABLE_MATH;
    let mut blocks = Vec::new();
    let mut text = String::new();
    let mut flush = |text: &mut String| {
        if !text.is_empty() {
            blocks.push(std::mem::take(text));
        }
    };
    for event in Parser::new_ext(markdown, options) {
        match event {
            Event::Text(t) => text.push_str(&t),
            Event::Code(t) => text.push_str(&format!("<code {t}>")),
            Event::InlineMath(t) | Event::DisplayMath(t) => text.push_str(&format!("<math {t}>")),
            Event::InlineHtml(t) | Event::Html(t) => text.push_str(&format!("<html {t}>")),
            Event::SoftBreak => text.push(' '),
            Event::HardBreak => text.push('\n'),
            Event::FootnoteReference(label) => text.push_str(&format!("[^{label}]")),
            Event::Start(Tag::Emphasis | Tag::Strong | Tag::Strikethrough | Tag::Link { .. }) => {
                text.push_str("<markup>")
            }
            Event::Start(Tag::List(_) | Tag::Item)
            | Event::End(
                TagEnd::Paragraph
                | TagEnd::Heading(_)
                | TagEnd::Item
                | TagEnd::TableCell
                | TagEnd::FootnoteDefinition,
            ) => flush(&mut text),
            _ => {}
        }
    }
    flush(&mut text);
    blocks
}

#[derive(serde::Deserialize)]
struct WordText {
    heading: String,
    paragraphs: Vec<String>,
    table: Vec<Vec<String>>,
}

/// The text of testdata/word-text.json as Word would hold it, opened: the
/// Markdown is testdata/word-text.md, which a frontend test reads back.
#[test]
fn opened_as_a_document_text_reads_back_as_the_same_words() {
    let fixture: WordText =
        serde_json::from_str(include_str!("../testdata/word-text.json")).unwrap();
    let row = |cells: &Vec<String>| {
        let cells: String = cells
            .iter()
            .map(|c| format!("<w:tc><w:p>{}</w:p></w:tc>", runs(c)))
            .collect();
        format!("<w:tr>{cells}</w:tr>")
    };
    let body = [
        format!(
            r#"<w:p><w:pPr><w:outlineLvl w:val="0"/></w:pPr>{}</w:p>"#,
            runs(&fixture.heading)
        ),
        fixture
            .paragraphs
            .iter()
            .map(|text| format!("<w:p>{}</w:p>", runs(text)))
            .collect(),
        format!(
            "<w:tbl>{}</w:tbl>",
            fixture.table.iter().map(row).collect::<String>()
        ),
    ]
    .concat();
    let (markdown, _) = open(&body, &[]);
    assert_eq!(
        markdown,
        include_str!("../testdata/word-text.md").trim_end()
    );

    let mut expected = vec![fixture.heading.clone()];
    expected.extend(fixture.paragraphs.iter().cloned());
    expected.extend(fixture.table.iter().flatten().cloned());
    assert_eq!(read_back(&markdown), expected);
    // The AI reads the same file as written, unescaped.
    assert!(convert(&body, &[]).contains("Price: $5 and $10, *each* or _two_"));
}

#[test]
fn opened_as_a_document_emphasis_lists_and_footnotes_still_mean_markdown() {
    let notes = (
        "word/footnotes.xml",
        r#"<w:footnotes {W}><w:footnote w:id="1"><w:p><w:r><w:t xml:space="preserve">See [1], p. 5*</w:t></w:r></w:p></w:footnote></w:footnotes>"#,
    );
    let numbering = (
        "word/numbering.xml",
        r#"<w:numbering {W}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>"#,
    );
    let body = r#"
            <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>2 * 3</w:t></w:r><w:r><w:t xml:space="preserve"> is six</w:t></w:r><w:r><w:footnoteReference w:id="1"/></w:r></w:p>
            <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>1. item</w:t></w:r><w:r><w:br/><w:t># line</w:t></w:r></w:p>
            <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>_two_</w:t></w:r></w:p>"#;
    let (markdown, _) = open(body, &[notes, numbering]);
    assert_eq!(
            markdown,
            "**2 \\* 3** is six[^1]\n\n1. 1\\. item\\\n   \\# line\n2. \\_two\\_\n\n[^1]: See \\[1], p. 5\\*"
        );
    assert_eq!(
        read_back(&markdown),
        [
            "<markup>2 * 3 is six[^1]",
            "1. item\n# line",
            "_two_",
            "See [1], p. 5*"
        ]
    );
}

#[test]
fn opened_as_a_document_pictures_are_saved_once_and_linked() {
    let rels = (
        "word/_rels/document.xml.rels",
        r#"<Relationships>
                <Relationship Id="rId4" Type="image" Target="media/image1.png"/>
                <Relationship Id="rId5" Type="image" Target="https://example.com/logo.png" TargetMode="External"/>
            </Relationships>"#,
    );
    let picture = |id: &str, alt: &str| {
        format!(
            r#"<w:p><w:r><w:drawing><wp:inline xmlns:wp="wp"><wp:docPr id="1" descr="{alt}"/><a:graphic xmlns:a="a"><a:graphicData><pic:pic xmlns:pic="pic"><pic:blipFill><a:blip r:embed="{id}"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>"#
        )
    };
    let body = [
        picture("rId4", "A barn"),
        picture("rId4", "The barn again"),
        picture("rId5", "Logo"),
    ]
    .concat();
    let (markdown, saved) = open(&body, &[rels, ("word/media/image1.png", "PNG bytes")]);
    assert_eq!(
            markdown,
            "![A barn](/drafts/image-1.png)\n\n![The barn again](/drafts/image-1.png)\n\n![Logo](https://example.com/logo.png)"
        );
    assert_eq!(saved, [("image1.png".to_string(), b"PNG bytes".to_vec())]);
}
