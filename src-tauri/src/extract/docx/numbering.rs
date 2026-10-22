//! A Word file's list numbering: which numbered paragraphs are ordered
//! lists and which bullets, level by level.

use super::*;

/// Which list levels are bullets, and what number each numbered item
/// shows: numId -> abstractNumId -> each level's numFmt and start, with the
/// numId's own start overrides on top.
#[derive(Default)]
pub(crate) struct Numbering {
    pub(crate) abstract_of: HashMap<String, String>,
    /// (abstractNumId, ilvl) -> numFmt
    pub(crate) formats: HashMap<(String, usize), String>,
    /// (abstractNumId, ilvl) -> w:start
    pub(crate) starts: HashMap<(String, usize), usize>,
    /// (numId, ilvl) -> w:startOverride: Word's "Restart at 1" is a new
    /// numId on the same definition, with this.
    pub(crate) start_overrides: HashMap<(String, usize), usize>,
    /// The number last shown at each level of each numId, counted as the
    /// body is read.
    pub(crate) counters: HashMap<String, Vec<Option<usize>>>,
}

impl Numbering {
    pub(crate) fn parse(xml: &[u8]) -> Self {
        let mut numbering = Self::default();
        let mut x = Pull::new(xml);
        let mut abstract_id = String::new();
        let mut num_id = String::new();
        let mut level = 0;
        let number = |tag: &Tag, name: &str| tag.attr(name).and_then(|v| v.parse().ok());
        loop {
            match x.next() {
                Node::Open(tag) => match tag.name.as_str() {
                    "abstractNum" => {
                        abstract_id = tag.attr("abstractNumId").unwrap_or_default().to_string()
                    }
                    "lvl" => level = number(&tag, "ilvl").unwrap_or(0),
                    "numFmt" => {
                        let format = tag.attr("val").unwrap_or_default().to_string();
                        numbering
                            .formats
                            .insert((abstract_id.clone(), level), format);
                    }
                    "start" => {
                        if let Some(start) = number(&tag, "val") {
                            numbering.starts.insert((abstract_id.clone(), level), start);
                        }
                    }
                    "num" => num_id = tag.attr("numId").unwrap_or_default().to_string(),
                    "abstractNumId" => {
                        let id = tag.attr("val").unwrap_or_default().to_string();
                        numbering.abstract_of.insert(num_id.clone(), id);
                    }
                    // A level override may restate a level's format too; the
                    // abstract definition is close enough to say "bullet".
                    "lvlOverride" => {
                        let level = number(&tag, "ilvl").unwrap_or(0);
                        loop {
                            match x.next() {
                                Node::Open(child) => {
                                    if child.name == "startOverride" {
                                        if let Some(start) = number(&child, "val") {
                                            numbering
                                                .start_overrides
                                                .insert((num_id.clone(), level), start);
                                        }
                                    }
                                    x.skip();
                                }
                                Node::Close | Node::End => break,
                                Node::Text(_) => {}
                            }
                        }
                    }
                    _ => {}
                },
                Node::End => break,
                _ => {}
            }
        }
        numbering
    }

    /// Without a numbering part, or for a level it doesn't define, a list is
    /// taken to be bulleted: "1." would claim an order the file never gave.
    pub(crate) fn is_bullet(&self, num_id: &str, level: usize) -> bool {
        let format = self
            .abstract_of
            .get(num_id)
            .and_then(|a| self.formats.get(&(a.clone(), level)));
        !matches!(format.map(String::as_str), Some(f) if f != "bullet" && f != "none")
    }

    /// The number the next item at `level` of list `num_id` shows, counted
    /// as Word counts: on from the item before it at that level, and from
    /// the level's start again after an item of a higher level. Markdown
    /// keeps a list's first number, so this is what makes a list that starts
    /// at 5, or goes on after a paragraph, read as it does in Word. Letters
    /// and Roman numerals are written as the numbers they count.
    pub(crate) fn next_number(&mut self, num_id: &str, level: usize) -> usize {
        let start = self
            .start_overrides
            .get(&(num_id.to_string(), level))
            .or_else(|| {
                let abstract_id = self.abstract_of.get(num_id)?;
                self.starts.get(&(abstract_id.clone(), level))
            })
            .copied()
            .unwrap_or(1);
        let counters = self.counters.entry(num_id.to_string()).or_default();
        counters.resize(level + 1, None);
        let number = counters[level].map_or(start, |last| last + 1);
        counters[level] = Some(number);
        number
    }
}
