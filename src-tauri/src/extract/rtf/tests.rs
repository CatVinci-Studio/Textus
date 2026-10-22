use super::*;

#[test]
fn textedit_rtf_reads_as_markdown() {
    // What TextEdit saves: a font table, \uc0 with \u for anything past
    // ASCII, and list markers in \listtext groups.
    let rtf = br#"{\rtf1\ansi\ansicpg1252\cocoartf2761
{\fonttbl\f0\fswiss\fcharset0 Helvetica;}
{\colortbl;\red255\green255\blue255;}
\pard\f0\fs24 Plain, {\b bold} and \i italic\i0  \'93quoted\'94.\par
\pard\outlinelevel0 Chapter One\par
\pard{\listtext\uc0\u8226 	}First item\par
{\listtext	\uc0\u8226 	}Second \uc0\u20320 \u22909 \par
\pard After {\field{\*\fldinst{HYPERLINK "https://example.com/"}}{\fldrslt the link}}.\par
}"#;
    assert_eq!(
            rtf_to_markdown(rtf),
            "Plain, **bold** and *italic* \u{201c}quoted\u{201d}.\n\n# Chapter One\n\n- First item\n- Second \u{4f60}\u{597d}\n\nAfter [the link](https://example.com/)."
        );
}

#[test]
fn unicode_fallbacks_are_skipped_and_codepages_decoded() {
    // Word writes \u with a one-character fallback (\uc1) for old
    // readers; reading both would double every character. \'c4\'e3 is
    // GBK for 你 in a document declaring code page 936.
    let rtf = br#"{\rtf1\ansi\ansicpg936 caf\u233?, \'c4\'e3, \u-10179?\u-8704?\par}"#;
    assert_eq!(rtf_to_markdown(rtf), "caf\u{e9}, \u{4f60}, \u{1f600}");
}

#[test]
fn footnotes_go_to_the_end() {
    // Word's form and pandoc's, which marks the group ignorable.
    let rtf = br#"{\rtf1 Claim{\super\chftn}{\footnote\pard\plain{\super\chftn} Smith, 1999.} and{\*\footnote\chftn\pard Ibid.}.\par}"#;
    assert_eq!(
        rtf_to_markdown(rtf),
        "Claim[^1] and[^2].\n\n[^1]: Smith, 1999.\n\n[^2]: Ibid."
    );
}

#[test]
fn heading_styles_and_tables_are_kept() {
    // LibreOffice's RTF: headings by style number, cells ended by
    // \cell and rows by \row.
    let rtf =
        br#"{\rtf1{\stylesheet{\s0 Normal;}{\s1\sbasedon0\snext2 heading 1;}{\*\cs15 Strong;}}
\pard\plain\s1 Chapter {\b One}\par
\pard\plain\s0 Text.\par
\trowd\cellx1000\cellx2000
\pard\intbl Name\cell\pard\intbl Role\cell\row
\pard\intbl Maria\cell\pard\intbl Volunteer\par\pard\intbl weekends\cell\row
\pard After.\par}"#;
    assert_eq!(
            rtf_to_markdown(rtf),
            "# Chapter One\n\nText.\n\n| Name | Role |\n| --- | --- |\n| Maria | Volunteer<br>weekends |\n\nAfter."
        );
}

#[test]
fn a_file_that_is_not_rtf_says_so() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("x.rtf");
    std::fs::write(&path, b"plain text").unwrap();
    assert_eq!(
        rtf_markdown(&path).unwrap_err(),
        "This .rtf is not a readable RTF file."
    );
}
