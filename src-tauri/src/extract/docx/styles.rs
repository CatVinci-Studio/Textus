//! A Word file's paragraph and character styles, followed through
//! their `basedOn` chain: which are headings, code, quotes, bold or italic.

use super::*;

#[derive(Default)]
pub(crate) struct Style {
    /// Lowercase: the built-in names ("heading 1") are stored in English
    /// whatever the language of Word, while style ids are localized.
    pub(crate) name: String,
    pub(crate) based_on: Option<String>,
    pub(crate) outline: Option<usize>,
    pub(crate) numbering: Option<(usize, String)>,
}

#[derive(Default)]
pub(crate) struct Styles(HashMap<String, Style>);

impl Styles {
    pub(crate) fn parse(xml: &[u8]) -> Self {
        let mut styles = HashMap::new();
        let mut x = Pull::new(xml);
        loop {
            match x.next() {
                Node::Open(tag) if tag.name == "style" => {
                    let id = tag.attr("styleId").unwrap_or_default().to_string();
                    styles.insert(id, style(&mut x));
                }
                Node::End => break,
                _ => {}
            }
        }
        Self(styles)
    }

    pub(crate) fn name(&self, id: &str) -> &str {
        self.0.get(id).map(|s| s.name.as_str()).unwrap_or_default()
    }

    /// The styles `id` is, from itself down the basedOn chain - bounded,
    /// since nothing stops a file from basing two styles on each other.
    pub(crate) fn chain<'a>(&'a self, id: &'a str) -> impl Iterator<Item = &'a Style> + 'a {
        let mut next = Some(id);
        std::iter::from_fn(move || {
            let style = self.0.get(next?)?;
            next = style.based_on.as_deref();
            Some(style)
        })
        .take(8)
    }

    /// A built-in heading style, or one based on it, is a heading of its level.
    /// "Title" only as itself: pandoc's "Author" and "Date" are based on it.
    pub(crate) fn heading(&self, id: &str) -> Option<usize> {
        if self.name(id) == "title" {
            return Some(1);
        }
        self.chain(id).find_map(|style| {
            let named = style.name.strip_prefix("heading ");
            named
                .and_then(|n| n.trim().parse::<usize>().ok())
                .filter(|level| (1..=9).contains(level))
                .or(style.outline)
        })
    }

    /// Word's "Quote" and "Intense Quote", and the "Block Text" pandoc and
    /// older templates use.
    pub(crate) fn is_quote(&self, id: &str) -> bool {
        self.chain(id).any(|style| {
            matches!(
                style.name.as_str(),
                "quote" | "intense quote" | "block text"
            )
        })
    }

    pub(crate) fn numbering(&self, id: &str) -> Option<(usize, String)> {
        self.chain(id).find_map(|style| style.numbering.clone())
    }
}

pub(crate) fn style(x: &mut Pull) -> Style {
    let mut style = Style::default();
    let mut ilvl = 0;
    let mut depth = 0usize;
    loop {
        match x.next() {
            Node::Open(tag) => {
                match tag.name.as_str() {
                    "name" => style.name = tag.attr("val").unwrap_or_default().to_lowercase(),
                    "basedOn" => style.based_on = tag.attr("val").map(str::to_string),
                    "outlineLvl" => style.outline = heading_of_outline(&tag),
                    "ilvl" => ilvl = tag.attr("val").and_then(|v| v.parse().ok()).unwrap_or(0),
                    "numId" => style.numbering = tag.attr("val").map(|id| (ilvl, id.to_string())),
                    _ => {}
                }
                depth += 1;
            }
            Node::Close if depth == 0 => return style,
            Node::Close => depth -= 1,
            Node::Text(_) => {}
            Node::End => return style,
        }
    }
}
