//! A web page's main content as Markdown, for web_fetch: what isn't
//! content (scripts, navigation, page headers and footers, forms, hidden
//! elements) taken out, the page's <main> or <article> kept when it has
//! one, and the rest written by the converter attachments use
//! (extract::html, on html5ever). Readability's Rust port, dom_smoothie,
//! was measured for this and dropped: +1.39 MB on the Linux x86_64 release
//! binary, for a model that needs a page's words, headings, lists and links.

use dom_query::Document;

/// Never content, wherever it is.
const NOT_CONTENT: &str = "script, style, noscript, template, svg, iframe, canvas, object, \
    nav, aside, form, button, select, textarea, dialog, \
    [hidden], [aria-hidden=\"true\"], [role=\"navigation\"], [role=\"search\"]";

/// Main content shorter than this is taken as a teaser, not the page: the
/// whole body is used instead.
const MIN_MAIN_CHARS: usize = 200;

/// The page's title and its content as Markdown, its links made absolute.
pub(crate) fn page_markdown(html: &str, url: &str) -> (String, String) {
    let doc = Document::from(html);
    let title = page_title(&doc);
    doc.select(NOT_CONTENT).remove();
    for node in doc.select("[style]").nodes() {
        let style = node
            .attr("style")
            .map(|s| s.replace(' ', "").to_ascii_lowercase())
            .unwrap_or_default();
        if style.contains("display:none") || style.contains("visibility:hidden") {
            node.remove_from_parent();
        }
    }
    // A page's own header and footer go; an article's (its title, byline)
    // stay.
    for node in doc.select("header, footer").nodes() {
        if !node.ancestors_it(None).any(|a| a.is("article")) {
            node.remove_from_parent();
        }
    }
    if let Ok(base) = reqwest::Url::parse(url) {
        for (selector, attr) in [("a[href]", "href"), ("img[src]", "src")] {
            for node in doc.select(selector).nodes() {
                if let Some(joined) = node
                    .attr(attr)
                    .and_then(|v| base.join(&v).ok())
                    .filter(|u| u.scheme() == "http" || u.scheme() == "https")
                {
                    node.set_attr(attr, joined.as_str());
                }
            }
        }
    }
    let main = doc.select("main, article, [role=\"main\"]").first();
    let content = if main.exists() && main.text().trim().chars().count() >= MIN_MAIN_CHARS {
        main.html()
    } else {
        doc.select("body").html()
    };
    (title, crate::extract::html_to_markdown(&content))
}

fn page_title(doc: &Document) -> String {
    let title = doc.select("title").first().text();
    let title = if title.trim().is_empty() {
        doc.select("meta[property=\"og:title\"]")
            .attr("content")
            .unwrap_or_default()
    } else {
        title
    };
    title.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_article_keeps_its_headings_lists_and_links_and_loses_the_chrome() {
        let html = r#"<html><head><title>On tides | Sea Notes</title><style>p{color:red}</style></head><body>
            <header><nav><a href="/">Home</a> <a href="/about">About</a></nav></header>
            <main><article>
              <header><h1>On tides</h1></header>
              <p>The moon pulls the sea twice a day, so the water rises and falls along every coast in a rhythm that sailors and fishermen have counted on for centuries.</p>
              <h2>Spring tides</h2>
              <p>Spring tides come at new and full moon, when the sun and the moon pull in one line. See <a href="/tables">the tide tables</a> &amp; charts.</p>
              <ul><li>Highest of the month</li><li>Twice a month</li></ul>
              <p style="display: none">hidden tracking text</p>
              <!-- a comment <p>not text</p> -->
            </article></main>
            <footer>© Sea Notes</footer><script>if (a < b) track()</script></body></html>"#;
        let (title, text) = page_markdown(html, "https://sea.example/tides");
        assert_eq!(title, "On tides | Sea Notes");
        assert!(text.starts_with("# On tides"), "{text}");
        assert!(text.contains("## Spring tides"), "{text}");
        assert!(
            text.contains("[the tide tables](https://sea.example/tables)"),
            "{text}"
        );
        assert!(text.contains("Highest of the month"), "{text}");
        for gone in [
            "track()",
            "Home",
            "hidden tracking",
            "not text",
            "color:red",
            "© Sea",
        ] {
            assert!(!text.contains(gone), "{gone} in {text}");
        }
    }

    #[test]
    fn a_page_without_main_content_gives_its_body() {
        let html = "<html><head><title>Links</title></head><body><ul><li>One</li><li>Two &#x4e2d;&#25991;</li></ul><script>x()</script></body></html>";
        let (title, text) = page_markdown(html, "https://example.com/");
        assert_eq!(title, "Links");
        assert!(text.contains("One") && text.contains("Two 中文"), "{text}");
        assert!(!text.contains("x()"), "{text}");
    }
}
