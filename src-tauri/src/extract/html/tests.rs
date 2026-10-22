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
    let html =
        "<p>first<p>second<ul><li>a<li>b</ul><table><tr><th>H<th>I<tr><td colspan=2>wide</table>";
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
