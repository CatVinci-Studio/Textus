//! An agent step in the Responses API: the conversation as input items,
//! the tools, and the output read back - its citation markers stripped
//! and its cited spans numbered.

use super::*;

pub(crate) fn turn_to_input_item(turn: &AgentTurn) -> Value {
    match turn {
        AgentTurn::User { text, images } => {
            // Images come first, so the text reads as a question about the
            // picture above it.
            let mut content: Vec<Value> = images
                .iter()
                .map(|image| json!({"type": "input_image", "image_url": image.data_url()}))
                .collect();
            content.push(json!({"type": "input_text", "text": text}));
            json!({
                "type": "message",
                "role": "user",
                "content": content,
            })
        }
        AgentTurn::Assistant { text, .. } => json!({
            "type": "message",
            "role": "assistant",
            "content": [{"type": "output_text", "text": text}],
        }),
        AgentTurn::ToolCall {
            call_id,
            name,
            arguments,
            ..
        } => json!({
            "type": "function_call",
            "call_id": call_id,
            "name": name,
            "arguments": arguments,
        }),
        AgentTurn::ToolResult {
            call_id, output, ..
        } => json!({
            "type": "function_call_output",
            "call_id": call_id,
            "output": output,
        }),
    }
}

/// One turn's `input` items: its own, and after a tool result that showed
/// images, a user message carrying them, the one place every Responses server
/// is known to read an `input_image`.
pub(crate) fn turn_to_input_items(turn: &AgentTurn) -> Vec<Value> {
    let mut items = vec![turn_to_input_item(turn)];
    if let AgentTurn::ToolResult { images, .. } = turn {
        if !images.is_empty() {
            let mut content: Vec<Value> = images
                .iter()
                .map(|image| json!({"type": "input_image", "image_url": image.data_url()}))
                .collect();
            content.push(json!({"type": "input_text", "text": tool_images_note(images)}));
            items.push(json!({"type": "message", "role": "user", "content": content}));
        }
    }
    items
}

pub(crate) fn tool_to_schema(tool: &ToolSpec) -> Value {
    json!({
        "type": "function",
        "name": tool.name,
        "description": tool.description,
        "parameters": tool.parameters,
    })
}

/// Builds a Responses API request body for one agent step: the full turn
/// history as `input` items plus tool definitions. Reasoning items are not sent
/// back: with `store: false` the API needs only the calls and outputs.
pub fn agent_request_body(
    model: &str,
    instructions: &str,
    history: &[AgentTurn],
    tools: &[ToolSpec],
    web_search: bool,
    thinking: &Thinking,
    streaming: bool,
) -> Value {
    let input: Vec<Value> = history.iter().flat_map(turn_to_input_items).collect();
    let mut tool_schemas: Vec<Value> = tools.iter().map(tool_to_schema).collect();
    // OpenAI's server-side web search runs inside the response, so just
    // offering it is enough.
    if web_search {
        tool_schemas.push(json!({"type": "web_search"}));
    }

    let mut body = json!({
        "model": model,
        "store": false,
        "stream": streaming,
        "instructions": instructions,
        "input": input,
        "tools": tool_schemas,
        "tool_choice": "auto",
        "parallel_tool_calls": true,
    });
    if supports_verbosity(model) {
        body["text"] = json!({"verbosity": "low"});
    }
    thinking.apply_responses(&mut body);
    body
}

/// `text` without the citation markers OpenAI's models write in their own app's
/// format (`\u{e200}cite\u{e202}turn3view0\u{e201}`, or with its delimiters
/// lost), which would reach documents as garbage. A space left before
/// punctuation goes too.
pub fn strip_citation_markers(text: &str) -> String {
    if !text.contains('\u{e200}') && !text.contains("citeturn") {
        return text.to_string();
    }
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    loop {
        let delimited = rest.find('\u{e200}');
        let bare = rest.find("citeturn");
        let at = match (delimited, bare) {
            (Some(a), Some(b)) => a.min(b),
            (Some(a), None) | (None, Some(a)) => a,
            (None, None) => break,
        };
        out.push_str(&rest[..at]);
        let marker = &rest[at..];
        let len = if marker.starts_with('\u{e200}') {
            marker
                .find('\u{e201}')
                .map_or(marker.len(), |end| end + '\u{e201}'.len_utf8())
        } else {
            bare_marker_len(marker)
        };
        rest = &marker[len..];
        // "found it citeturn1view0." reads "found it."
        let next = rest.chars().next();
        if next.is_none_or(|c| c.is_whitespace() || ".,;:!?)，。；：！？）、".contains(c)) {
            let trimmed = out.trim_end_matches([' ', '\t']).len();
            out.truncate(trimmed);
        }
    }
    out.push_str(rest);
    // A private-use delimiter left over on its own.
    out.retain(|c| !('\u{e200}'..='\u{e2ff}').contains(&c));
    out
}

/// The length of a `citeturnNkindM(turnNkindM...)` marker at the start of
/// `text`.
pub(crate) fn bare_marker_len(text: &str) -> usize {
    let mut at = "cite".len();
    loop {
        let rest = &text[at..];
        let Some(after) = rest.strip_prefix("turn") else {
            break;
        };
        let digits = after.chars().take_while(char::is_ascii_digit).count();
        let kind = after[digits..]
            .chars()
            .take_while(char::is_ascii_lowercase)
            .count();
        let number = after[digits + kind..]
            .chars()
            .take_while(char::is_ascii_digit)
            .count();
        if digits == 0 || kind == 0 || number == 0 {
            break;
        }
        at += "turn".len() + digits + kind + number;
    }
    at
}

/// Tool arguments without citation markers in what they write. Not in an
/// `anchor` or `context`, which quote the document and must still match it.
pub(crate) fn strip_markers_in_arguments(arguments: &str) -> String {
    if !arguments.contains("citeturn")
        && !arguments.contains('\u{e200}')
        && !arguments.contains("\\ue200")
    {
        return arguments.to_string();
    }
    fn walk(value: &mut Value) {
        match value {
            Value::String(s) => *s = strip_citation_markers(s),
            Value::Array(items) => items.iter_mut().for_each(walk),
            Value::Object(map) => map
                .iter_mut()
                .filter(|(key, _)| !matches!(key.as_str(), "anchor" | "context"))
                .for_each(|(_, v)| walk(v)),
            _ => {}
        }
    }
    match serde_json::from_str::<Value>(arguments) {
        Ok(mut value) => {
            walk(&mut value);
            value.to_string()
        }
        Err(_) => arguments.to_string(),
    }
}

/// A message part's text with its `url_citation` annotations marked
/// ([`mark_cited_spans`]). xAI's annotations carry the citation's number as
/// their `title`, not the page's: a title that is only digits is no title.
pub(crate) fn cited_part_text(
    part: &Value,
    citations: &mut StepCitations,
    on_event: EventSink<'_>,
) -> String {
    let text = part
        .get("text")
        .and_then(|t| t.as_str())
        .unwrap_or_default();
    let spans: Vec<CitedSpan<'_>> = part
        .get("annotations")
        .and_then(|a| a.as_array())
        .into_iter()
        .flatten()
        .filter(|a| a.get("type").and_then(|t| t.as_str()) == Some("url_citation"))
        .filter_map(|a| {
            let index = |key: &str| a.get(key).and_then(|v| v.as_u64()).map(|v| v as usize);
            let title = a.get("title").and_then(|t| t.as_str()).unwrap_or_default();
            Some(CitedSpan {
                start: index("start_index")?,
                end: index("end_index")?,
                url: a.get("url").and_then(|u| u.as_str())?,
                title: if title.chars().all(|c| c.is_ascii_digit()) {
                    ""
                } else {
                    title
                },
            })
        })
        .collect();
    if spans.is_empty() {
        return text.to_string();
    }
    mark_cited_spans(text, spans, citations, on_event)
}

/// Parses a Responses API `output` item array (streamed or not) into a
/// [`StepResult`]. The pages a native web search cited are reported from the
/// text's annotations and the sources a `web_search_call` lists.
pub fn parse_agent_output(output: &[Value], on_event: EventSink<'_>) -> StepResult {
    let mut tool_calls = Vec::new();
    let mut text_parts = Vec::new();
    let mut citations = StepCitations::default();

    for item in output {
        match item.get("type").and_then(|t| t.as_str()) {
            Some("web_search_call") => {
                for source in item
                    .pointer("/action/sources")
                    .and_then(|s| s.as_array())
                    .into_iter()
                    .flatten()
                {
                    if let Some(url) = source.get("url").and_then(|u| u.as_str()) {
                        let title = source.get("title").and_then(|t| t.as_str()).unwrap_or("");
                        citations.cite(url, title, on_event);
                    }
                }
            }
            Some("function_call") => {
                let call_id = item
                    .get("call_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default();
                let name = item
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default();
                let arguments = item
                    .get("arguments")
                    .and_then(|v| v.as_str())
                    .unwrap_or("{}");
                tool_calls.push(AgentTurn::ToolCall {
                    call_id: call_id.to_string(),
                    name: name.to_string(),
                    arguments: strip_markers_in_arguments(arguments),
                    reasoning: None,
                });
            }
            Some("message") => {
                if let Some(content) = item.get("content").and_then(|c| c.as_array()) {
                    for part in content {
                        if part.get("text").and_then(|t| t.as_str()).is_some() {
                            let text = cited_part_text(part, &mut citations, on_event);
                            text_parts.push(strip_citation_markers(&text));
                        }
                    }
                }
            }
            _ => {}
        }
    }

    if !tool_calls.is_empty() {
        StepResult::calls_with_text(tool_calls, text_parts.join("\n"))
    } else {
        StepResult::Done(text_parts.join("\n"))
    }
}
