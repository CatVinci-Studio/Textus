//! Pictures written into new text: each is a line of its own in the proposed
//! text, `![alt](textus-picture:16:9 what it shows)`, and starts being made the
//! moment its line has streamed in. Placed, the lines become
//! `![alt](textus-generated:ID)` as for any other picture.

use super::{placeholder_src, ImageRun};
use crate::ai::agent::StreamEvent;
use crate::ai::tools::ProposalLedger;
use aicompat::agent::{AgentTurn, ProviderEvent, StepResult};
use aicompat::images::Aspect;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Mutex;

/// The src of a picture line. Keep in step with the frontend's `PICTURE_LINE`.
pub(super) const PICTURE_SCHEME: &str = "textus-picture:";

/// One picture line read: its alt text, the description it is made from,
/// its shape, and the src of the picture it is drawn like (or "").
#[derive(Debug, PartialEq)]
struct PictureLine<'a> {
    alt: &'a str,
    prompt: &'a str,
    aspect: Aspect,
    like: &'a str,
}

/// `line` as a picture line, if it is one: `![alt](textus-picture:` then
/// an optional aspect, an optional `like:SRC`, and the description, up to
/// the line's last `)` (a description may have parentheses of its own).
fn picture_line(line: &str) -> Option<PictureLine<'_>> {
    let rest = line.trim().strip_prefix("![")?;
    let (alt, after) = rest.split_once("](")?;
    if alt.contains(']') {
        return None;
    }
    let body = after
        .strip_prefix(PICTURE_SCHEME)?
        .strip_suffix(')')?
        .trim();
    let (aspect, rest) = match body.split_once(char::is_whitespace) {
        Some((first, rest)) if Aspect::parse(first).is_some() => {
            (Aspect::parse(first).unwrap_or_default(), rest.trim())
        }
        _ => (Aspect::default(), body),
    };
    let (like, prompt) = match rest.strip_prefix("like:") {
        Some(after) => after
            .split_once(char::is_whitespace)
            .map_or((after, ""), |(src, prompt)| (src, prompt.trim())),
        None => ("", rest),
    };
    (!prompt.is_empty()).then_some(PictureLine {
        alt: alt.trim(),
        prompt,
        aspect,
        like,
    })
}

/// What came of a picture line: the picture being made (its id and the
/// size it is asked for), or why none is.
type Started = Result<(String, (u32, u32)), String>;

/// A tool call streaming in: whether it proposes text, its arguments so
/// far, and the picture lines the frontend has been told of.
#[derive(Default)]
struct Streaming {
    proposes: bool,
    args: String,
    told: Vec<String>,
}

/// One request's pictures written into its text.
pub struct InlinePictures<'a> {
    run: &'a ImageRun,
    ledger: &'a Mutex<ProposalLedger>,
    streams: Mutex<HashMap<String, Streaming>>,
    /// Each picture line seen, trimmed, and what came of it: the same line again
    /// (the finished step, or a retried step) is the same picture, not a second
    /// one paid for.
    started: Mutex<Vec<(String, Started)>>,
}

impl ImageRun {
    /// This request's pictures written into its text, recorded in the
    /// ledger its propose_edit calls check them against.
    pub fn inline<'a>(&'a self, ledger: &'a Mutex<ProposalLedger>) -> InlinePictures<'a> {
        InlinePictures {
            run: self,
            ledger,
            streams: Mutex::default(),
            started: Mutex::default(),
        }
    }
}

impl InlinePictures<'_> {
    /// A streamed fragment of the step: each picture line it completes in
    /// a propose_edit's text starts its picture, and the frontend is told
    /// (before the fragment itself, so the line never shows as text).
    pub fn observe(&self, event: &ProviderEvent<'_>) -> Vec<StreamEvent> {
        let mut streams = self.streams.lock().unwrap_or_else(|e| e.into_inner());
        let (call_id, delta) = match event {
            ProviderEvent::ToolStart { call_id, name } => {
                streams.insert(
                    call_id.to_string(),
                    Streaming {
                        proposes: *name == "propose_edit",
                        ..Streaming::default()
                    },
                );
                return Vec::new();
            }
            ProviderEvent::ToolArgs { call_id, delta } => (call_id, delta),
            _ => return Vec::new(),
        };
        // A provider that didn't say which tool: read it as propose_edit,
        // the one with a `text`.
        let stream = streams
            .entry(call_id.to_string())
            .or_insert_with(|| Streaming {
                proposes: true,
                ..Streaming::default()
            });
        if !stream.proposes {
            return Vec::new();
        }
        stream.args.push_str(delta);
        let Some((text, closed)) = partial_string(&stream.args, "text") else {
            return Vec::new();
        };
        let lines: Vec<&str> = text.split('\n').collect();
        // The last line is complete only once the text is.
        let complete = if closed { lines.len() } else { lines.len() - 1 };
        let mut events = Vec::new();
        for line in lines[..complete].iter().map(|l| l.trim()) {
            if stream.told.iter().any(|t| t == line) {
                continue;
            }
            let Some(picture) = picture_line(line) else {
                continue;
            };
            stream.told.push(line.to_string());
            if let Ok((id, (width, height))) = self.start(line, &picture) {
                events.push(StreamEvent::Picture {
                    call_id: call_id.to_string(),
                    line: line.to_string(),
                    id,
                    width,
                    height,
                });
            }
        }
        events
    }

    /// The picture for `line`: the one already begun for it, or one begun
    /// now.
    fn start(&self, line: &str, picture: &PictureLine<'_>) -> Started {
        let mut started = self.started.lock().unwrap_or_else(|e| e.into_inner());
        if let Some((_, known)) = started.iter().find(|(l, _)| l == line) {
            return known.clone();
        }
        let outcome =
            self.run
                .begin_picture(picture.prompt.to_string(), picture.aspect, picture.like);
        if let Ok((id, _)) = &outcome {
            self.ledger
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .add_picture(id.clone());
        }
        started.push((line.to_string(), outcome.clone()));
        outcome
    }

    /// The step as it came back, each propose_edit's picture lines turned into
    /// their pictures' Markdown. A line whose picture can't be made is left out,
    /// and propose_edit's result says why.
    pub fn place(&self, step: StepResult) -> StepResult {
        self.streams
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clear();
        let StepResult::ToolCalls(calls) = step else {
            return step;
        };
        let calls = calls
            .into_iter()
            .map(|turn| match turn {
                AgentTurn::ToolCall {
                    call_id,
                    name,
                    arguments,
                    reasoning,
                } if name == "propose_edit" => AgentTurn::ToolCall {
                    arguments: self.place_in(&arguments).unwrap_or(arguments),
                    call_id,
                    name,
                    reasoning,
                },
                other => other,
            })
            .collect();
        StepResult::ToolCalls(calls)
    }

    /// One propose_edit's arguments with its picture lines placed; None
    /// when it has none.
    fn place_in(&self, arguments: &str) -> Option<String> {
        let mut args: Value = serde_json::from_str(arguments).ok()?;
        let text = args.get("text")?.as_str()?;
        if !text.contains(PICTURE_SCHEME) {
            return None;
        }
        let mut out: Vec<String> = Vec::new();
        for line in text.split('\n') {
            let Some(picture) = picture_line(line) else {
                out.push(line.to_string());
                continue;
            };
            match self.start(line.trim(), &picture) {
                Ok((id, _)) => out.push(format!(
                    "![{}]({})",
                    picture.alt.replace('[', ""),
                    placeholder_src(&id)
                )),
                Err(why) => {
                    let mut ledger = self.ledger.lock().unwrap_or_else(|e| e.into_inner());
                    ledger.note_unmade(why);
                }
            }
        }
        let mut placed = out.join("\n");
        // A line left out leaves its blank lines behind.
        while placed.contains("\n\n\n") {
            placed = placed.replace("\n\n\n", "\n\n");
        }
        args["text"] = Value::String(placed.trim_matches('\n').to_string());
        Some(args.to_string())
    }
}

/// The value of the string field `key` in JSON that is still streaming
/// in, as far as it has come, and whether it is complete. None until its
/// opening quote has arrived.
fn partial_string(json: &str, key: &str) -> Option<(String, bool)> {
    let quoted = format!("\"{key}\"");
    let mut from = 0;
    let start = loop {
        let at = from + json[from..].find(&quoted)?;
        // A key, not the same letters inside a string (`\"text\"`).
        let escaped = json[..at].chars().rev().take_while(|c| *c == '\\').count() % 2 == 1;
        let after = json[at + quoted.len()..].trim_start();
        if !escaped {
            if let Some(value) = after.strip_prefix(':') {
                if let Some(value) = value.trim_start().strip_prefix('"') {
                    break json.len() - value.len();
                }
            }
        }
        from = at + quoted.len();
    };
    let mut out = String::new();
    let mut chars = json[start..].chars();
    while let Some(c) = chars.next() {
        match c {
            '"' => return Some((out, true)),
            '\\' => match chars.next() {
                Some('n') => out.push('\n'),
                Some('t') => out.push('\t'),
                Some('r') => out.push('\r'),
                Some('b') => out.push('\u{8}'),
                Some('f') => out.push('\u{c}'),
                Some('u') => {
                    let hex: String = chars.by_ref().take(4).collect();
                    let unit = (hex.len() == 4)
                        .then(|| u16::from_str_radix(&hex, 16).ok())
                        .flatten();
                    let Some(unit) = unit else {
                        // Cut off inside the escape: what came before it.
                        return Some((out, false));
                    };
                    if (0xd800..0xdc00).contains(&unit) {
                        let rest = chars.as_str();
                        let low = rest
                            .strip_prefix("\\u")
                            .and_then(|r| r.get(..4))
                            .and_then(|h| u16::from_str_radix(h, 16).ok());
                        let Some(low) = low else {
                            return Some((out, false));
                        };
                        chars = rest[6..].chars();
                        out.extend(char::decode_utf16([unit, low]).flatten());
                    } else {
                        out.extend(char::from_u32(unit.into()));
                    }
                }
                Some(other) => out.push(other),
                None => return Some((out, false)),
            },
            c => out.push(c),
        }
    }
    Some((out, false))
}

#[cfg(test)]
mod tests;
