//! A reply split as it streams in: the text outside the tags (the chat
//! reply) and each `<textus-edit …>` tag's attributes and body, the body in
//! pieces as they come. Read loosely: a tag may share a line with its text,
//! attributes take either quote or none, and a tag still open when the
//! reply ends closes there. Nothing outside the tags is held back except
//! what could still turn into one.

use std::collections::BTreeMap;

const OPEN: &str = "<textus-edit";
const CLOSE: &str = "</textus-edit>";

/// A tag's attributes, by name.
pub type Attrs = BTreeMap<String, String>;

/// A piece of the reply, in order. `index` counts the tags from 0.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Piece {
    Text(String),
    Open { index: usize, attrs: Attrs },
    Body { index: usize, text: String },
    Close { index: usize },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Mode {
    Outside,
    /// Between `<textus-edit` and its `>`.
    Opening,
    /// In a tag's body; `started` once its leading line break is gone.
    Inside {
        index: usize,
        started: bool,
    },
}

/// The reply split so far. `push` each delta, then `finish`.
#[derive(Clone, Debug)]
pub struct TagSplitter {
    mode: Mode,
    /// Text not decided yet: a possible start of a tag, its attributes, or
    /// the end of a body that may be its closing tag.
    held: String,
    tags: usize,
}

impl Default for TagSplitter {
    fn default() -> Self {
        Self {
            mode: Mode::Outside,
            held: String::new(),
            tags: 0,
        }
    }
}

impl TagSplitter {
    pub fn push(&mut self, delta: &str) -> Vec<Piece> {
        self.held.push_str(delta);
        let mut out = Vec::new();
        while self.step(&mut out, false) {}
        out
    }

    /// The rest, the reply being complete.
    pub fn finish(&mut self) -> Vec<Piece> {
        let mut out = Vec::new();
        while self.step(&mut out, true) {}
        let rest = std::mem::take(&mut self.held);
        match self.mode {
            Mode::Outside => push_text(&mut out, rest),
            // `<textus-edit` and no `>`: it was text after all.
            Mode::Opening => push_text(&mut out, format!("{OPEN}{rest}")),
            Mode::Inside { index, .. } => {
                let body = trim_breaks(&rest);
                if !body.is_empty() {
                    out.push(Piece::Body {
                        index,
                        text: body.to_string(),
                    });
                }
                out.push(Piece::Close { index });
            }
        }
        self.mode = Mode::Outside;
        out
    }

    /// One move on what is held; false when it must wait for more.
    fn step(&mut self, out: &mut Vec<Piece>, ending: bool) -> bool {
        match self.mode {
            Mode::Outside => {
                let Some(at) = self.held.find(OPEN) else {
                    let keep = if ending {
                        0
                    } else {
                        partial_suffix(&self.held, OPEN)
                    };
                    let cut = self.held.len() - keep;
                    let text: String = self.held.drain(..cut).collect();
                    push_text(out, text);
                    return false;
                };
                // `<textus-editor`: not the tag.
                match self.held[at + OPEN.len()..].chars().next() {
                    None if !ending => {
                        let text: String = self.held.drain(..at).collect();
                        push_text(out, text);
                        return false;
                    }
                    Some(c) if !(c.is_whitespace() || c == '>' || c == '/') => {
                        let text: String = self.held.drain(..at + OPEN.len()).collect();
                        push_text(out, text);
                        return true;
                    }
                    None => return false,
                    _ => {}
                }
                let text: String = self.held.drain(..at).collect();
                push_text(out, text);
                self.held.drain(..OPEN.len());
                self.mode = Mode::Opening;
                true
            }
            Mode::Opening => {
                let Some(end) = tag_end(&self.held) else {
                    return false;
                };
                let inner: String = self.held.drain(..=end).collect();
                let inner = &inner[..inner.len() - 1];
                let (inner, empty) = match inner.trim_end().strip_suffix('/') {
                    Some(rest) => (rest, true),
                    None => (inner, false),
                };
                let index = self.tags;
                self.tags += 1;
                out.push(Piece::Open {
                    index,
                    attrs: parse_attrs(inner),
                });
                if empty {
                    out.push(Piece::Close { index });
                    self.mode = Mode::Outside;
                } else {
                    self.mode = Mode::Inside {
                        index,
                        started: false,
                    };
                }
                true
            }
            Mode::Inside { index, started } => {
                if !started {
                    if self.held.is_empty() || self.held == "\r" {
                        return false;
                    }
                    if let Some(rest) = self
                        .held
                        .strip_prefix("\r\n")
                        .or_else(|| self.held.strip_prefix('\n'))
                    {
                        self.held = rest.to_string();
                    }
                    self.mode = Mode::Inside {
                        index,
                        started: true,
                    };
                    return true;
                }
                if let Some(at) = self.held.find(CLOSE) {
                    let body: String = self.held.drain(..at).collect();
                    self.held.drain(..CLOSE.len());
                    let body = trim_breaks(&body);
                    if !body.is_empty() {
                        out.push(Piece::Body {
                            index,
                            text: body.to_string(),
                        });
                    }
                    out.push(Piece::Close { index });
                    self.mode = Mode::Outside;
                    return true;
                }
                if ending {
                    return false;
                }
                // Keep what may be the start of the closing tag, and the line
                // breaks before it, which aren't part of the body.
                let mut cut = self.held.len() - partial_suffix(&self.held, CLOSE);
                while cut > 0 && matches!(self.held.as_bytes()[cut - 1], b'\n' | b'\r') {
                    cut -= 1;
                }
                if cut > 0 {
                    let text: String = self.held.drain(..cut).collect();
                    out.push(Piece::Body { index, text });
                }
                false
            }
        }
    }
}

/// Text joined onto the text piece before it, if that is the last piece.
fn push_text(out: &mut Vec<Piece>, text: String) {
    if text.is_empty() {
        return;
    }
    if let Some(Piece::Text(last)) = out.last_mut() {
        last.push_str(&text);
    } else {
        out.push(Piece::Text(text));
    }
}

/// How many bytes at the end of `text` are the start of `marker`.
fn partial_suffix(text: &str, marker: &str) -> usize {
    (1..marker.len().min(text.len() + 1))
        .rev()
        .find(|&n| {
            text.is_char_boundary(text.len() - n) && marker.starts_with(&text[text.len() - n..])
        })
        .unwrap_or(0)
}

/// The byte of the `>` that ends a tag's attributes, outside quotes.
fn tag_end(text: &str) -> Option<usize> {
    let mut quote: Option<char> = None;
    for (i, c) in text.char_indices() {
        match (quote, c) {
            (Some(q), c) if c == q => quote = None,
            (Some(_), _) => {}
            (None, '"' | '\'') => quote = Some(c),
            (None, '>') => return Some(i),
            _ => {}
        }
    }
    None
}

/// `name="value"`, `name='value'` or `name=value`, in any order.
fn parse_attrs(inner: &str) -> Attrs {
    let mut attrs = Attrs::new();
    let mut rest = inner.trim_start();
    while !rest.is_empty() {
        let name_len = rest
            .find(|c: char| c == '=' || c.is_whitespace())
            .unwrap_or(rest.len());
        let name = rest[..name_len].to_string();
        rest = rest[name_len..].trim_start();
        let Some(after_eq) = rest.strip_prefix('=') else {
            if !name.is_empty() {
                attrs.insert(name.to_ascii_lowercase(), String::new());
            }
            continue;
        };
        rest = after_eq.trim_start();
        let (value, after) = match rest.chars().next() {
            Some(q @ ('"' | '\'')) => match rest[1..].find(q) {
                Some(end) => (&rest[1..1 + end], &rest[2 + end..]),
                None => (&rest[1..], ""),
            },
            _ => {
                let end = rest.find(char::is_whitespace).unwrap_or(rest.len());
                (&rest[..end], &rest[end..])
            }
        };
        if !name.is_empty() {
            attrs.insert(name.to_ascii_lowercase(), value.to_string());
        }
        rest = after.trim_start();
    }
    attrs
}

/// A body without the line breaks that end it before the closing tag.
fn trim_breaks(body: &str) -> &str {
    body.trim_end_matches(['\n', '\r'])
}
