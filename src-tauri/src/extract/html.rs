//! HTML to Markdown: headings, paragraphs, lists, quotes, code blocks,
//! tables, emphasis, links and images. For .html attachments and the
//! chapters of an EPUB here, and for any caller that has a web page and
//! wants what a model reads best - `html_to_markdown` takes a string.
//!
//! The rules follow MarkItDown's HTML converter (github.com/microsoft/
//! markitdown, MIT; converters/_html_converter.py and _markdownify.py):
//! scripts and styles dropped, `#` headings, links kept only for schemes a
//! reader can follow (no `javascript:`), an image's `data:` URI cut to its
//! type so a pasted screenshot doesn't fill the prompt with base64, a lazy
//! image's `data-src` preferred over its placeholder, and checkboxes as
//! `[x]` / `[ ]`. Parsing is html5ever's, the browsers' algorithm, so tag
//! soup - unclosed `<p>` and `<li>`, stray end tags - reads as a browser
//! would show it.

use super::markdown::{self, Marks};
use dom_query::{Document, NodeRef};

/// The Markdown of an HTML document or fragment. Never fails: HTML has no
/// malformed input, only input a browser repairs.
pub(crate) fn html_to_markdown(html: &str) -> String {
    let document = Document::from(html);
    let mut writer = Writer::default();
    writer.children(&document.root());
    writer.finish()
}

#[derive(Default)]
struct Writer {
    out: String,
    /// The paragraph being written, whitespace already collapsed.
    line: String,
    /// Bumped whenever `line` is flushed, so an inline element can tell its
    /// text was split by a block inside it (`<a><div>…</div></a>`) and leave
    /// it unwrapped rather than wrap the wrong text.
    flushes: usize,
    /// Inside a list item: a nested list follows the item's text on the next
    /// line, keeping the list tight.
    in_item: bool,
}

impl Writer {
    fn children(&mut self, node: &NodeRef) {
        for child in node.children() {
            self.node(&child);
        }
    }

    fn node(&mut self, node: &NodeRef) {
        if node.is_text() {
            self.text(&node.text());
            return;
        }
        if !node.is_element() && !node.is_document() {
            return;
        }
        let name = node
            .node_name()
            .map(|n| n.to_ascii_lowercase())
            .unwrap_or_default();
        match name.as_str() {
            "head" | "script" | "style" | "noscript" | "template" | "svg" | "math" | "canvas"
            | "iframe" | "object" | "embed" | "select" | "textarea" | "button" => {}
            "br" => {
                self.line.truncate(self.line.trim_end_matches(' ').len());
                self.line.push('\n');
            }
            "hr" => self.block("---", false),
            "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => {
                let level = usize::from(name.as_bytes()[1] - b'0');
                let text = inline_of(node);
                self.block(&format!("{} {text}", "#".repeat(level)), false);
            }
            "ul" | "ol" => {
                let list = list(node, name == "ol");
                self.block(&list, self.in_item);
            }
            "blockquote" => {
                let inner = render(node, false);
                let quoted: Vec<String> = inner
                    .lines()
                    .map(|line| {
                        if line.is_empty() {
                            ">".to_string()
                        } else {
                            format!("> {line}")
                        }
                    })
                    .collect();
                self.block(&quoted.join("\n"), false);
            }
            "pre" => self.block(&code_block(node), false),
            "table" => self.block(&table(node), false),
            "img" => {
                let image = image(node);
                self.line.push_str(&image);
            }
            "input" => {
                if node
                    .attr("type")
                    .is_some_and(|t| t.eq_ignore_ascii_case("checkbox"))
                {
                    self.text(if node.has_attr("checked") {
                        "[x] "
                    } else {
                        "[ ] "
                    });
                }
            }
            "a" => {
                let href = node
                    .attr("href")
                    .map(|h| h.to_string())
                    .filter(|h| followable(h));
                self.wrapped(node, |inner| match &href {
                    Some(url) => markdown::linked(inner, url),
                    None => inner.to_string(),
                });
            }
            "strong" | "b" => self.emphasized(node, |m| m.bold = true),
            "em" | "i" | "cite" | "dfn" => self.emphasized(node, |m| m.italic = true),
            "del" | "s" | "strike" => self.emphasized(node, |m| m.strike = true),
            "code" | "kbd" | "samp" | "tt" => {
                let code = collapse(&node.text());
                if !code.trim().is_empty() {
                    self.text_raw(&inline_code(code.trim()));
                }
            }
            "p" | "div" | "section" | "article" | "main" | "header" | "footer" | "aside"
            | "nav" | "figure" | "figcaption" | "address" | "details" | "summary" | "center"
            | "form" | "fieldset" | "dl" | "dt" | "dd" | "li" | "body" | "html" | "caption" => {
                self.flush();
                self.children(node);
                self.flush();
            }
            _ => self.children(node),
        }
    }

    /// Text as a browser lays it out: runs of whitespace are one space, and
    /// none at the start of a line. Only ASCII whitespace - a no-break space
    /// is a character the author put there.
    fn text(&mut self, text: &str) {
        for c in text.chars() {
            if c.is_ascii_whitespace() {
                if !self.line.is_empty() && !self.line.ends_with([' ', '\n']) {
                    self.line.push(' ');
                }
            } else {
                self.line.push(c);
            }
        }
    }

    fn text_raw(&mut self, markdown: &str) {
        self.line.push_str(markdown);
    }

    /// The children of `node` written inline, then `wrap`ped as a whole.
    fn wrapped(&mut self, node: &NodeRef, wrap: impl Fn(&str) -> String) {
        let (flushes, start) = (self.flushes, self.line.len());
        self.children(node);
        if self.flushes != flushes {
            return;
        }
        let inner = self.line.split_off(start);
        self.line.push_str(&wrap(&inner));
    }

    fn emphasized(&mut self, node: &NodeRef, mark: impl Fn(&mut Marks)) {
        let mut marks = Marks::default();
        mark(&mut marks);
        self.wrapped(node, |inner| markdown::emphasize(inner, marks));
    }

    fn flush(&mut self) {
        let text: Vec<&str> = self.line.lines().map(str::trim).collect();
        let text = text.join("\n");
        self.line.clear();
        self.flushes += 1;
        self.block(text.trim(), false);
    }

    /// A finished block; `tight` joins it to the one before with a single
    /// newline (a nested list under its item's text).
    fn block(&mut self, markdown: &str, tight: bool) {
        if !self.line.is_empty() {
            self.flush();
        }
        if markdown.trim().is_empty() {
            return;
        }
        if !self.out.is_empty() {
            self.out.push_str(if tight { "\n" } else { "\n\n" });
        }
        self.out.push_str(markdown.trim_end());
    }

    fn finish(mut self) -> String {
        self.flush();
        self.out
    }
}

/// `node`'s children as Markdown of their own: a list item's, a quote's or
/// a table cell's content.
fn render(node: &NodeRef, in_item: bool) -> String {
    let mut writer = Writer {
        in_item,
        ..Writer::default()
    };
    writer.children(node);
    writer.finish()
}

/// The inline Markdown of `node`'s children, as one line.
fn inline_of(node: &NodeRef) -> String {
    let markdown = render(node, false);
    let lines: Vec<&str> = markdown
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .collect();
    lines.join(" ")
}

fn list(node: &NodeRef, ordered: bool) -> String {
    let mut number: i64 = node
        .attr("start")
        .and_then(|s| s.trim().parse().ok())
        .unwrap_or(1);
    let mut items: Vec<String> = Vec::new();
    for child in node.children().iter().filter(|c| c.is_element()) {
        let name = child
            .node_name()
            .map(|n| n.to_ascii_lowercase())
            .unwrap_or_default();
        match name.as_str() {
            "li" => {
                let content = render(child, true);
                if content.is_empty() {
                    continue;
                }
                let marker = if ordered {
                    let marker = format!("{number}.");
                    number += 1;
                    marker
                } else {
                    "-".to_string()
                };
                items.push(hang(&marker, &content));
            }
            // `<ul><li>a</li><ul>…</ul></ul>`: invalid, and common - the
            // list belongs under the item before it.
            "ul" | "ol" => {
                let nested = list(child, name == "ol");
                let indented: Vec<String> = nested.lines().map(|l| format!("    {l}")).collect();
                if !nested.is_empty() {
                    items.push(indented.join("\n"));
                }
            }
            _ => {}
        }
    }
    items.join("\n")
}

/// A list item: the marker before its first line, the rest indented under
/// the text so CommonMark keeps them in the item.
fn hang(marker: &str, content: &str) -> String {
    let indent = " ".repeat(marker.len() + 1);
    let mut out = String::new();
    for (i, line) in content.lines().enumerate() {
        if i == 0 {
            out.push_str(&format!("{marker} {line}"));
        } else if line.is_empty() {
            out.push('\n');
        } else {
            out.push_str(&format!("\n{indent}{line}"));
        }
    }
    out
}

fn code_block(node: &NodeRef) -> String {
    let code = node.text();
    let code = code.trim_end_matches(['\n', '\r']);
    let class_of = |n: &NodeRef| n.attr("class").map(|c| c.to_string()).unwrap_or_default();
    let mut classes = class_of(node);
    if let Some(inner) = node.first_element_child() {
        classes.push(' ');
        classes.push_str(&class_of(&inner));
    }
    let language = classes
        .split_whitespace()
        .find_map(|c| {
            c.strip_prefix("language-")
                .or_else(|| c.strip_prefix("lang-"))
        })
        .unwrap_or_default();
    // A fence longer than any backtick run inside, so the code can't end it.
    let longest = code.split(|c| c != '`').map(str::len).max().unwrap_or(0);
    let fence = "`".repeat(longest.max(2) + 1);
    format!("{fence}{language}\n{code}\n{fence}")
}

fn inline_code(code: &str) -> String {
    if code.contains('`') {
        format!("`` {code} ``")
    } else {
        format!("`{code}`")
    }
}

fn table(node: &NodeRef) -> String {
    let mut rows = Vec::new();
    let mut caption = String::new();
    collect_rows(node, &mut rows, &mut caption);
    let table = markdown::table(&rows);
    if caption.is_empty() {
        table
    } else {
        format!("{caption}\n\n{table}")
    }
}

/// The rows of a table, through its row groups but not into a table nested
/// in a cell (that one is the cell's content).
fn collect_rows(node: &NodeRef, rows: &mut Vec<Vec<String>>, caption: &mut String) {
    for child in node.children().iter().filter(|c| c.is_element()) {
        let name = child
            .node_name()
            .map(|n| n.to_ascii_lowercase())
            .unwrap_or_default();
        match name.as_str() {
            "thead" | "tbody" | "tfoot" => collect_rows(child, rows, caption),
            "caption" => *caption = render(child, false),
            "tr" => {
                let mut row = Vec::new();
                for cell in child.children().iter().filter(|c| c.is_element()) {
                    let cell_name = cell
                        .node_name()
                        .map(|n| n.to_ascii_lowercase())
                        .unwrap_or_default();
                    if cell_name != "td" && cell_name != "th" {
                        continue;
                    }
                    row.push(render(cell, false));
                    let span: usize = cell
                        .attr("colspan")
                        .and_then(|s| s.trim().parse().ok())
                        .unwrap_or(1);
                    row.extend(std::iter::repeat_n(String::new(), span.clamp(1, 64) - 1));
                }
                rows.push(row);
            }
            _ => {}
        }
    }
}

fn image(node: &NodeRef) -> String {
    let attr = |name: &str| node.attr(name).map(|v| v.to_string()).unwrap_or_default();
    let alt = attr("alt")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .replace(['[', ']'], "");
    let mut src = attr("src");
    let lazy = attr("data-src");
    if !lazy.is_empty() && (src.is_empty() || is_data_uri(&src)) {
        src = lazy;
    }
    if is_data_uri(&src) {
        // `data:image/png;base64,iVBOR…` -> `data:image/png;base64...`
        src = format!("{}...", src.split(',').next().unwrap_or_default());
    }
    if alt.is_empty() && src.is_empty() {
        return String::new();
    }
    format!("![{alt}]({})", markdown::link_target(&src))
}

fn is_data_uri(src: &str) -> bool {
    src.get(..5)
        .is_some_and(|s| s.eq_ignore_ascii_case("data:"))
}

/// A link a reader can follow: relative, or http(s), file or mailto. A
/// `javascript:` link keeps its text and loses the link, as in MarkItDown.
fn followable(href: &str) -> bool {
    let href = href.trim();
    if href.is_empty() {
        return false;
    }
    let scheme_end = href.find([':', '/', '?', '#']);
    match scheme_end {
        Some(i) if href.as_bytes()[i] == b':' => {
            matches!(
                href[..i].to_ascii_lowercase().as_str(),
                "http" | "https" | "file" | "mailto"
            )
        }
        _ => true,
    }
}

fn collapse(text: &str) -> String {
    text.split_ascii_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn structure_becomes_markdown() {
        let html = r#"<!doctype html><html><head><title>T</title><style>p{}</style></head><body>
            <h1>Title</h1>
            <p>Some <b>bold</b> and <em>italic</em>
               text with a <a href="https://example.com/x">link</a>.</p>
            <script>var a = 1 < 2;</script>
            <ul><li>one</li><li>two<ol start="3"><li>three</li></ol></li></ul>
            <blockquote><p>Quoted.</p><p>Twice.</p></blockquote>
            <pre><code class="language-rust">fn main() {
    println!("hi");
}</code></pre>
            <p>Line<br>break and <code>x &lt; y</code></p>
        </body></html>"#;
        assert_eq!(
            html_to_markdown(html),
            "# Title\n\n\
             Some **bold** and *italic* text with a [link](https://example.com/x).\n\n\
             - one\n- two\n  3. three\n\n\
             > Quoted.\n>\n> Twice.\n\n\
             ```rust\nfn main() {\n    println!(\"hi\");\n}\n```\n\n\
             Line\nbreak and `x < y`"
        );
    }

    #[test]
    fn tag_soup_reads_as_a_browser_shows_it() {
        let html = "<p>first<p>second<ul><li>a<li>b</ul><table><tr><th>H<th>I<tr><td colspan=2>wide</table>";
        assert_eq!(
            html_to_markdown(html),
            "first\n\nsecond\n\n- a\n- b\n\n| H | I |\n| --- | --- |\n| wide |  |"
        );
    }

    #[test]
    fn links_and_images_follow_markitdown() {
        let html = r#"<a href="javascript:void(0)">Click</a> <a href="notes.html#top">notes</a>
            <img alt="A chart" src="data:image/png;base64,iVBORw0KGgo=">
            <img alt="Lazy" src="data:image/gif;base64,R0lG" data-src="/big.png">
            <input type="checkbox" checked> done <input type="checkbox"> todo"#;
        assert_eq!(
            html_to_markdown(html),
            "Click [notes](notes.html#top) ![A chart](data:image/png;base64...) ![Lazy](/big.png) [x] done [ ] todo"
        );
    }

    #[test]
    fn emphasis_split_by_a_block_is_left_alone() {
        assert_eq!(
            html_to_markdown("<a href='/x'>a<div>b</div>c</a>"),
            "a\n\nb\n\nc"
        );
    }
}
