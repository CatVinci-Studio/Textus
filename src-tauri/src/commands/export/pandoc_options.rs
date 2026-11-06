//! Settings › Editor › Export for a Pandoc export: contents, numbered
//! headings, a bibliography, and the user's own arguments per format.

/// What a Pandoc export takes from Settings besides the Word template.
/// Shared with `PandocOptions` in `src/export/pandoc-options.ts`.
#[cfg(desktop)]
#[derive(serde::Deserialize, Default)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct PandocOptions {
    pub toc: bool,
    pub number_sections: bool,
    /// A .bib (or CSL JSON/YAML) file; citeproc runs only with one.
    pub bibliography: Option<String>,
    pub csl: Option<String>,
    /// The user's arguments for this format, as an argv list.
    pub extra_args: Vec<String>,
}

/// Options the export sets itself: where it reads, what it writes, and to
/// which file. The input is stdin, so a file name is refused too.
const OWNED_LONG: &[&str] = &["from", "read", "to", "write", "output"];
const OWNED_SHORT: &[char] = &['f', 'r', 't', 'w', 'o'];
/// Short options whose value follows, attached or as the next word.
const SHORT_WITH_VALUE: &[char] = &['M', 'd', 'V', 'H', 'B', 'A', 'F', 'L', 'T', 'c', 'D'];
/// Short options with an optional attached value (`-strue`).
const SHORT_OPTIONAL: &[char] = &['s', 'N', 'p', 'i'];
/// Long options whose value may be the next word (`--metadata title=x`).
const LONG_WITH_VALUE: &[&str] = &[
    "abbreviations",
    "base-header-level",
    "bibliography",
    "chunk-template",
    "citation-abbreviations",
    "columns",
    "csl",
    "css",
    "data-dir",
    "defaults",
    "dpi",
    "epub-chapter-level",
    "epub-cover-image",
    "epub-embed-font",
    "epub-metadata",
    "epub-subdirectory",
    "extract-media",
    "filter",
    "highlight-style",
    "id-prefix",
    "include-after-body",
    "include-before-body",
    "include-in-header",
    "indented-code-classes",
    "log",
    "lua-filter",
    "math-method",
    "metadata",
    "metadata-file",
    "number-offset",
    "pdf-engine",
    "pdf-engine-opt",
    "reference-doc",
    "request-header",
    "resource-path",
    "shift-heading-level-by",
    "slide-level",
    "split-level",
    "syntax-definition",
    "tab-stop",
    "template",
    "title-prefix",
    "toc-depth",
    "variable",
    "variable-json",
];

/// The first of `args` that would take over what the export owns, or None.
/// Pandoc takes a long option's unique prefix, so `--out` is `--output`; a
/// prefix shared with others is ambiguous to Pandoc and refused here too.
pub fn owned_arg(args: &[String]) -> Option<&str> {
    let mut value_next = false;
    for arg in args {
        if std::mem::take(&mut value_next) {
            continue;
        }
        if let Some(long) = arg.strip_prefix("--") {
            let (name, value) = long
                .split_once('=')
                .map_or((long, None), |(n, v)| (n, Some(v)));
            if name.is_empty() || OWNED_LONG.iter().any(|o| o.starts_with(name)) {
                return Some(arg);
            }
            value_next = value.is_none() && LONG_WITH_VALUE.iter().any(|o| o.starts_with(name));
        } else if let Some(short) = arg.strip_prefix('-').filter(|s| !s.is_empty()) {
            for (i, c) in short.char_indices() {
                if OWNED_SHORT.contains(&c) {
                    return Some(arg);
                }
                if SHORT_WITH_VALUE.contains(&c) {
                    value_next = i + c.len_utf8() == short.len();
                    break;
                }
                if SHORT_OPTIONAL.contains(&c) {
                    break;
                }
            }
        } else {
            return Some(arg);
        }
    }
    None
}

/// Turns `[x]{.textus-sub}`, `[x]{.textus-sup}` and `` `[@key]`{=textuscite} ``,
/// which the export writes for the editor's `~x~`, `^x^` and citations, into
/// Pandoc's own: the reader has no sub/superscript or citations to match it.
pub const LUA_FILTER: &str = r#"function Span(s)
  if s.classes:includes("textus-sub") then return pandoc.Subscript(s.content) end
  if s.classes:includes("textus-sup") then return pandoc.Superscript(s.content) end
end
function RawInline(r)
  if r.format == "textuscite" then
    local blocks = pandoc.read(r.text, "markdown+citations").blocks
    if blocks[1] then return blocks[1].content end
  end
end
"#;

#[cfg(desktop)]
/// The filter's file, written where each export can read it.
pub fn lua_filter_path() -> std::io::Result<std::path::PathBuf> {
    let path = std::env::temp_dir().join(format!("textus-pandoc-{}.lua", std::process::id()));
    std::fs::write(&path, LUA_FILTER)?;
    Ok(path)
}

#[cfg(desktop)]
/// The arguments Settings adds, after the user's own so the app's win.
pub fn settings_args(options: &PandocOptions) -> Vec<String> {
    let mut args = Vec::new();
    if options.toc {
        args.push("--toc".into());
    }
    if options.number_sections {
        args.push("--number-sections".into());
    }
    if let Some(bib) = options.bibliography.as_deref().filter(|b| !b.is_empty()) {
        args.push("--citeproc".into());
        args.push(format!("--bibliography={bib}"));
        if let Some(csl) = options.csl.as_deref().filter(|c| !c.is_empty()) {
            args.push(format!("--csl={csl}"));
        }
    }
    args
}

#[cfg(test)]
mod tests {
    use super::*;

    fn argv(words: &[&str]) -> Vec<String> {
        words.iter().map(|w| w.to_string()).collect()
    }

    #[test]
    fn the_export_keeps_its_input_format_and_output() {
        for owned in [
            "--output=x.docx",
            "--output",
            "--out=x",
            "-o",
            "-ox.docx",
            "-Co",
            "--from=markdown",
            "--read",
            "-f",
            "-r",
            "--to=html",
            "-t",
            "--write",
            "-w",
            "--",
            "notes.md",
        ] {
            assert_eq!(owned_arg(&argv(&[owned])), Some(owned), "{owned}");
        }
    }

    #[test]
    fn other_options_and_their_values_pass() {
        let ok = argv(&[
            "--toc-depth=2",
            "-V",
            "geometry:margin=1in",
            "--metadata",
            "title=Report",
            "-Vfontsize=12pt",
            "-N",
            "-strue",
            "--lua-filter",
            "wordcount.lua",
            "-C",
            "--reference-links",
            "--toc",
        ]);
        assert_eq!(owned_arg(&ok), None);
        // The value after -V is its own; "-o" after it is not an option.
        assert_eq!(owned_arg(&argv(&["-M", "-o"])), None);
        assert_eq!(owned_arg(&argv(&["-V", "a=b", "-o"])), Some("-o"));
    }

    #[test]
    fn settings_add_toc_numbers_and_citeproc() {
        let options = PandocOptions {
            toc: true,
            number_sections: true,
            bibliography: Some("/r/refs.bib".into()),
            csl: Some("/r/apa.csl".into()),
            extra_args: vec![],
        };
        assert_eq!(
            settings_args(&options),
            argv(&[
                "--toc",
                "--number-sections",
                "--citeproc",
                "--bibliography=/r/refs.bib",
                "--csl=/r/apa.csl",
            ])
        );
        let csl_alone = PandocOptions {
            csl: Some("/r/apa.csl".into()),
            ..Default::default()
        };
        assert!(settings_args(&csl_alone).is_empty());
    }

    /// Runs only where Pandoc is installed (CI has none).
    #[test]
    fn the_filter_makes_pandocs_sub_superscripts_and_citations() {
        use std::io::Write;
        use std::process::{Command, Stdio};
        let Ok(mut child) = Command::new("pandoc")
            .args(["--from", "commonmark_x", "--to", "native", "--lua-filter"])
            .arg(lua_filter_path().unwrap())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
        else {
            return;
        };
        child
            .stdin
            .take()
            .unwrap()
            .write_all(b"H[2]{.textus-sub}O x[2]{.textus-sup} `[@doe, p. 3]`{=textuscite}")
            .unwrap();
        let out = String::from_utf8(child.wait_with_output().unwrap().stdout).unwrap();
        assert!(out.contains("Subscript [ Str \"2\" ]"), "{out}");
        assert!(out.contains("Superscript [ Str \"2\" ]"), "{out}");
        assert!(out.contains("citationId = \"doe\""), "{out}");
    }
}
