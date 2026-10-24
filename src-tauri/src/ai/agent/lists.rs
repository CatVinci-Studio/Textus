//! Edits and comments travel as lists: the model sends all of a reply's
//! edits in one propose_edit call (`edits`) and all its comments in one
//! add_comment call (`comments`). A service that holds a step's parallel
//! calls back until the step ends - ChatGPT's, with no argument deltas
//! for any of them (2026-10: ten edits, thirty notes, all at once at the
//! end) - still streams a single call's arguments, so each edit and note
//! can show as soon as it is written.
//!
//! Everything past the model still sees one call per edit or comment, as
//! before: the stream (`ListStream`) and the step (`split_calls`) are split
//! into one call per item, `<call>#<n>`, which the tools, the history the
//! frontend keeps and the frontend itself handle as they always have; the
//! history sent back to the model is joined again (`join_calls`), each list
//! as the model wrote it, with one result.

use std::collections::HashMap;
use std::sync::Mutex;

use serde_json::Value;

use super::{AgentTurn, ProviderEvent, StepResult};
use crate::ai::tools;

/// The list a tool's calls carry their items in.
fn list_key(tool: &str) -> Option<&'static str> {
    match tool {
        tools::PROPOSE_EDIT_TOOL_NAME => Some("edits"),
        tools::ADD_COMMENT_TOOL_NAME => Some("comments"),
        _ => None,
    }
}

/// The id of a list call's `n`th item.
fn item_id(call_id: &str, n: usize) -> String {
    format!("{call_id}#{n}")
}

/// A list item's call id as its list's and its place in it.
fn list_of(item: &str) -> Option<(&str, usize)> {
    let (call_id, n) = item.rsplit_once('#')?;
    Some((call_id, n.parse().ok()?))
}

/// A step's list calls as one call per item. A call without its list (an
/// older shape, or one the model got wrong) stays as it came, for its tool
/// to answer.
pub(crate) fn split_calls(result: StepResult) -> StepResult {
    let StepResult::ToolCalls(calls) = result else {
        return result;
    };
    let mut out = Vec::with_capacity(calls.len());
    for turn in calls {
        let AgentTurn::ToolCall {
            call_id,
            name,
            arguments,
            reasoning,
        } = &turn
        else {
            out.push(turn);
            continue;
        };
        let items = list_key(name).and_then(|key| {
            let args: Value = serde_json::from_str(arguments).ok()?;
            args.get(key)?
                .as_array()
                .filter(|items| !items.is_empty())
                .cloned()
        });
        let Some(items) = items else {
            out.push(turn);
            continue;
        };
        for (n, item) in items.into_iter().enumerate() {
            out.push(AgentTurn::ToolCall {
                call_id: item_id(call_id, n),
                name: name.clone(),
                arguments: item.to_string(),
                // The reasoning before the call goes with it once.
                reasoning: if n == 0 { reasoning.clone() } else { None },
            });
        }
    }
    StepResult::ToolCalls(out)
}

/// History for the model: each list's item calls joined into the call the
/// model made, at the first item's place, and their results into one, at
/// the first result's - each item's numbered when there are several.
pub(crate) fn join_calls(turns: &[AgentTurn]) -> Vec<AgentTurn> {
    let mut items: HashMap<&str, Vec<(usize, &str)>> = HashMap::new();
    let mut results: HashMap<&str, Vec<(usize, &AgentTurn)>> = HashMap::new();
    for turn in turns {
        match turn {
            AgentTurn::ToolCall {
                call_id,
                name,
                arguments,
                ..
            } if list_key(name).is_some() => {
                if let Some((list, n)) = list_of(call_id) {
                    items.entry(list).or_default().push((n, arguments));
                }
            }
            AgentTurn::ToolResult { call_id, .. } => {
                if let Some((list, n)) = list_of(call_id) {
                    results.entry(list).or_default().push((n, turn));
                }
            }
            _ => {}
        }
    }
    if items.is_empty() {
        return turns.to_vec();
    }
    let lists: std::collections::HashSet<String> = items.keys().map(|l| l.to_string()).collect();
    fn joined<'a>(lists: &std::collections::HashSet<String>, id: &'a str) -> Option<&'a str> {
        list_of(id).map(|(l, _)| l).filter(|l| lists.contains(*l))
    }
    let mut out = Vec::with_capacity(turns.len());
    for turn in turns {
        match turn {
            AgentTurn::ToolCall {
                call_id,
                name,
                reasoning,
                ..
            } => {
                let Some(list) = joined(&lists, call_id) else {
                    out.push(turn.clone());
                    continue;
                };
                let Some(mut parts) = items.remove(list) else {
                    continue; // joined at its first item
                };
                parts.sort_by_key(|(n, _)| *n);
                let list_items: Vec<Value> = parts
                    .iter()
                    .map(|(_, args)| serde_json::from_str(args).unwrap_or(Value::Null))
                    .collect();
                let key = list_key(name).unwrap_or("items");
                out.push(AgentTurn::ToolCall {
                    call_id: list.to_string(),
                    name: name.clone(),
                    arguments: serde_json::json!({ key: list_items }).to_string(),
                    reasoning: reasoning.clone(),
                });
            }
            AgentTurn::ToolResult { call_id, .. } => {
                let Some(list) = joined(&lists, call_id) else {
                    out.push(turn.clone());
                    continue;
                };
                let Some(mut parts) = results.remove(list) else {
                    continue;
                };
                parts.sort_by_key(|(n, _)| *n);
                let mut images = Vec::new();
                let outputs: Vec<String> = parts
                    .iter()
                    .filter_map(|(n, turn)| match turn {
                        AgentTurn::ToolResult {
                            output,
                            images: shown,
                            ..
                        } => {
                            images.extend(shown.iter().cloned());
                            Some(if parts.len() == 1 {
                                output.clone()
                            } else {
                                format!("{}. {output}", n + 1)
                            })
                        }
                        _ => None,
                    })
                    .collect();
                out.push(AgentTurn::ToolResult {
                    call_id: list.to_string(),
                    output: outputs.join("\n"),
                    images,
                });
            }
            _ => out.push(turn.clone()),
        }
    }
    out
}

/// Where a list call's streaming arguments are: the JSON scanned so far,
/// for the item now open.
#[derive(Default)]
struct Scan {
    tool: String,
    key: &'static str,
    /// Nesting: '{' and '[' still open.
    stack: Vec<char>,
    in_string: bool,
    escaped: bool,
    /// The last string closed at the top level - the key a value follows.
    last_key: String,
    string: String,
    /// Inside the list's array.
    in_list: bool,
    /// The item being written, and how many were.
    open: Option<String>,
    items: usize,
}

/// Splits a list call's streaming arguments into one call per item as they
/// arrive: a ToolStart as an item opens, its JSON as ToolArgs, so a reader
/// of the stream sees each edit or comment as a call of its own.
#[derive(Default)]
pub(crate) struct ListStream {
    calls: Mutex<HashMap<String, Scan>>,
}

impl ListStream {
    pub(crate) fn feed(&self, event: ProviderEvent<'_>, out: &dyn Fn(ProviderEvent<'_>)) {
        let mut calls = self.calls.lock().unwrap_or_else(|e| e.into_inner());
        match event {
            ProviderEvent::ToolStart { call_id, name } => match list_key(name) {
                Some(key) => {
                    calls.insert(
                        call_id.to_string(),
                        Scan {
                            tool: name.to_string(),
                            key,
                            ..Scan::default()
                        },
                    );
                }
                None => out(event),
            },
            ProviderEvent::ToolArgs { call_id, delta } => match calls.get_mut(call_id) {
                Some(scan) => {
                    for (id, piece, opened) in scan.feed(call_id, delta) {
                        if opened {
                            out(ProviderEvent::ToolStart {
                                call_id: &id,
                                name: &scan.tool,
                            });
                        }
                        out(ProviderEvent::ToolArgs {
                            call_id: &id,
                            delta: &piece,
                        });
                    }
                }
                None => out(event),
            },
            other => out(other),
        }
    }
}

impl Scan {
    /// The pieces of `delta` that belong to items: (item id, its JSON,
    /// whether the item opens here).
    fn feed(&mut self, call_id: &str, delta: &str) -> Vec<(String, String, bool)> {
        let mut pieces: Vec<(String, String, bool)> = Vec::new();
        let mut piece = String::new();
        let mut opened = false;
        for ch in delta.chars() {
            let in_item = self.open.is_some();
            if self.in_string {
                if in_item {
                    piece.push(ch);
                } else {
                    self.string.push(ch);
                }
                if self.escaped {
                    self.escaped = false;
                } else if ch == '\\' {
                    self.escaped = true;
                } else if ch == '"' {
                    self.in_string = false;
                    if !in_item && self.stack.len() == 1 {
                        self.string.pop();
                        self.last_key = std::mem::take(&mut self.string);
                    }
                }
                continue;
            }
            match ch {
                '"' => {
                    self.in_string = true;
                    self.string.clear();
                    if in_item {
                        piece.push(ch);
                    }
                }
                '{' | '[' => {
                    if self.in_list && self.stack.len() == 2 && ch == '{' {
                        // The one before closed at its '}', its piece out.
                        self.open = Some(item_id(call_id, self.items));
                        self.items += 1;
                        opened = true;
                    }
                    if ch == '[' && self.stack.len() == 1 && self.last_key == self.key {
                        self.in_list = true;
                    }
                    self.stack.push(ch);
                    if self.open.is_some() {
                        piece.push(ch);
                    }
                }
                '}' | ']' => {
                    self.stack.pop();
                    if self.open.is_some() {
                        piece.push(ch);
                    }
                    if self.in_list && self.stack.len() == 2 && ch == '}' {
                        if let Some(id) = self.open.take() {
                            pieces.push((id, std::mem::take(&mut piece), opened));
                            opened = false;
                        }
                    }
                    if ch == ']' && self.stack.len() == 1 {
                        self.in_list = false;
                    }
                }
                _ => {
                    if self.open.is_some() {
                        piece.push(ch);
                    }
                }
            }
        }
        if let Some(id) = &self.open {
            if !piece.is_empty() || opened {
                pieces.push((id.clone(), piece, opened));
            }
        }
        pieces
    }
}

#[cfg(test)]
mod tests;
