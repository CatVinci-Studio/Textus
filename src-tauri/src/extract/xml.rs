//! A pull parser over one XML part: every element arrives as an `Open`
//! answered by one `Close`, and `skip` passes over one. Names are local names,
//! since OOXML files may bind namespaces to any prefix.

use quick_xml::events::{BytesStart, Event};
use quick_xml::Reader;

pub(crate) struct Tag {
    pub name: String,
    attrs: Vec<(String, String)>,
}

impl Tag {
    /// The attribute whose local name is `name` (`w:val`, `r:id` -> `val`,
    /// `id`).
    pub fn attr(&self, name: &str) -> Option<&str> {
        self.attrs
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.as_str())
    }

    /// An OOXML on/off property: `<w:b/>` and `<w:b w:val="true"/>` are on,
    /// `<w:b w:val="0"/>` - written to switch off a style's bold - is off.
    pub fn is_on(&self) -> bool {
        !matches!(self.attr("val"), Some("0" | "false" | "off" | "none"))
    }
}

pub(crate) enum Node {
    Open(Tag),
    Close,
    Text(String),
    End,
}

pub(crate) struct Pull<'a> {
    reader: Reader<&'a [u8]>,
    /// The Close owed for an empty element, handed out by the next `next`.
    owed_close: bool,
}

impl<'a> Pull<'a> {
    pub fn new(xml: &'a [u8]) -> Self {
        let mut reader = Reader::from_reader(xml);
        reader.config_mut().trim_text(false);
        Self {
            reader,
            owed_close: false,
        }
    }

    pub fn next(&mut self) -> Node {
        if std::mem::take(&mut self.owed_close) {
            return Node::Close;
        }
        loop {
            match self.reader.read_event() {
                Ok(Event::Start(e)) => return Node::Open(tag(&e)),
                Ok(Event::Empty(e)) => {
                    self.owed_close = true;
                    return Node::Open(tag(&e));
                }
                Ok(Event::End(_)) => return Node::Close,
                Ok(Event::Text(e)) => {
                    if let Ok(text) = e.decode() {
                        return Node::Text(text.into_owned());
                    }
                }
                Ok(Event::CData(e)) => {
                    if let Ok(text) = e.decode() {
                        return Node::Text(text.into_owned());
                    }
                }
                // `&amp;` and `&#8217;` arrive as their own event; ignoring it would drop
                // every escaped ampersand and curly quote.
                Ok(Event::GeneralRef(e)) => {
                    if let Ok(Some(c)) = e.resolve_char_ref() {
                        return Node::Text(c.to_string());
                    }
                    let name = e.decode().unwrap_or_default();
                    if let Some(text) = quick_xml::escape::resolve_predefined_entity(&name) {
                        return Node::Text(text.to_string());
                    }
                }
                // A truncated or malformed part reads as far as it is
                // well-formed rather than failing the whole file.
                Ok(Event::Eof) | Err(_) => return Node::End,
                Ok(_) => {}
            }
        }
    }

    /// Consumes the rest of the element just opened, through its Close.
    pub fn skip(&mut self) {
        let mut depth = 0usize;
        loop {
            match self.next() {
                Node::Open(_) => depth += 1,
                Node::Close if depth == 0 => return,
                Node::Close => depth -= 1,
                Node::Text(_) => {}
                Node::End => return,
            }
        }
    }

    /// All the text inside the element just opened, through its Close.
    pub fn text(&mut self) -> String {
        let mut out = String::new();
        let mut depth = 0usize;
        loop {
            match self.next() {
                Node::Open(_) => depth += 1,
                Node::Close if depth == 0 => return out,
                Node::Close => depth -= 1,
                Node::Text(text) => out.push_str(&text),
                Node::End => return out,
            }
        }
    }
}

fn tag(e: &BytesStart) -> Tag {
    let attrs = e
        .attributes()
        .flatten()
        .map(|a| {
            let key = local_name(a.key.as_ref()).to_string();
            let value = a
                .decoded_and_normalized_value(quick_xml::XmlVersion::default(), e.decoder())
                .map(|v| v.into_owned())
                .unwrap_or_default();
            (key, value)
        })
        .collect();
    Tag {
        name: local_name(e.name().as_ref()).to_string(),
        attrs,
    }
}

/// `w:t` -> `t`.
fn local_name(raw: &[u8]) -> &str {
    let name = std::str::from_utf8(raw).unwrap_or_default();
    name.rsplit(':').next().unwrap_or(name)
}

/// The relationships of one OOXML part (`_rels/*.rels`): what a `r:id` on a
/// hyperlink, an image or a notes slide points at.
#[derive(Default)]
pub(super) struct Rels(Vec<Rel>);

struct Rel {
    id: String,
    target: String,
    external: bool,
    kind: String,
}

impl Rels {
    pub fn parse(xml: &[u8]) -> Self {
        let mut pull = Pull::new(xml);
        let mut rels = Vec::new();
        loop {
            match pull.next() {
                Node::Open(tag) if tag.name == "Relationship" => {
                    rels.push(Rel {
                        id: tag.attr("Id").unwrap_or_default().to_string(),
                        target: tag.attr("Target").unwrap_or_default().to_string(),
                        external: tag.attr("TargetMode") == Some("External"),
                        kind: tag.attr("Type").unwrap_or_default().to_string(),
                    });
                }
                Node::End => break,
                _ => {}
            }
        }
        Self(rels)
    }

    /// The URL a hyperlink's `r:id` names. Internal targets (a bookmark,
    /// another part) are no link a reader can follow.
    pub fn link(&self, id: &str) -> Option<&str> {
        self.0
            .iter()
            .find(|rel| rel.id == id && rel.external)
            .map(|rel| rel.target.as_str())
    }

    pub fn target(&self, id: &str) -> Option<&str> {
        self.0
            .iter()
            .find(|rel| rel.id == id)
            .map(|rel| rel.target.as_str())
    }

    /// The first target whose relationship type ends with `/kind`
    /// (`notesSlide`, `footnotes`).
    pub fn of_kind(&self, kind: &str) -> Option<&str> {
        self.0
            .iter()
            .find(|rel| rel.kind.rsplit('/').next() == Some(kind))
            .map(|rel| rel.target.as_str())
    }
}

/// A relationship target as the zip entry it names:
/// `../notesSlides/notesSlide1.xml` from `ppt/slides/` -> `ppt/notesSlides/notesSlide1.xml`.
pub(super) fn resolve_part(dir: &str, target: &str) -> String {
    if let Some(absolute) = target.strip_prefix('/') {
        return absolute.to_string();
    }
    let mut parts: Vec<&str> = dir.split('/').filter(|p| !p.is_empty()).collect();
    for part in target.split('/') {
        match part {
            ".." => {
                parts.pop();
            }
            "." | "" => {}
            part => parts.push(part),
        }
    }
    parts.join("/")
}

/// The bytes of one zip entry, or None when the archive lacks it - most
/// parts (styles, numbering, notes) are optional.
pub(super) fn zip_entry<R: std::io::Read + std::io::Seek>(
    zip: &mut zip::ZipArchive<R>,
    name: &str,
) -> Option<Vec<u8>> {
    use std::io::Read;
    let mut entry = zip.by_name(name).ok()?;
    let mut bytes = Vec::new();
    entry.read_to_end(&mut bytes).ok()?;
    Some(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escaped_characters_are_kept() {
        let mut pull = Pull::new(b"<t>Tom &amp; Jerry &#8217;s</t>");
        assert!(matches!(pull.next(), Node::Open(_)));
        assert_eq!(pull.text(), "Tom & Jerry \u{2019}s");
    }

    #[test]
    fn an_empty_element_is_opened_and_closed() {
        let mut pull = Pull::new(br#"<p><x:br x:type="page"/>a</p>"#);
        assert!(matches!(pull.next(), Node::Open(t) if t.name == "p"));
        let Node::Open(br) = pull.next() else {
            panic!("expected <br/>")
        };
        assert_eq!((br.name.as_str(), br.attr("type")), ("br", Some("page")));
        assert!(matches!(pull.next(), Node::Close));
        assert!(matches!(pull.next(), Node::Text(t) if t == "a"));
    }

    #[test]
    fn relationship_targets_resolve_to_zip_entries() {
        assert_eq!(
            resolve_part("ppt/slides", "../notesSlides/notesSlide2.xml"),
            "ppt/notesSlides/notesSlide2.xml"
        );
        assert_eq!(
            resolve_part("OEBPS", "text/ch1.xhtml"),
            "OEBPS/text/ch1.xhtml"
        );
        assert_eq!(resolve_part("", "ch1.xhtml"), "ch1.xhtml");
    }
}
