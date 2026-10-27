//! An agent step's request body - the conversation as Messages API
//! content, cache breakpoints, the tools - and a whole reply read back.

use super::*;

/// `eager_input_streaming`: the arguments stream as Claude writes them
/// instead of each value arriving whole. They may then be invalid JSON; a
/// call that doesn't parse is refused like any other.
pub(crate) fn tool_to_schema(tool: &ToolSpec) -> Value {
    json!({
        "name": tool.name,
        "description": tool.description,
        "input_schema": tool.parameters,
        "eager_input_streaming": true,
    })
}

/// An image as a Messages API content block.
pub(crate) fn image_block(image: &ImageAttachment) -> Value {
    json!({
        "type": "image",
        "source": {
            "type": "base64",
            "media_type": image.mime,
            "data": image.data_base64,
        },
    })
}

/// Groups the flat `AgentTurn` history into Messages API turns. Roles must
/// alternate, so a step's calls form ONE assistant message of `tool_use`
/// blocks and its results ONE user message of `tool_result` blocks.
pub(crate) fn turns_to_messages(history: &[AgentTurn]) -> Vec<Value> {
    let mut messages = Vec::new();
    let mut i = 0;
    while i < history.len() {
        match &history[i] {
            AgentTurn::User { text, images } => {
                // A text-only turn keeps the plain-string `content` shape, so
                // the common request stays byte-identical to what it was before
                // images.
                if images.is_empty() {
                    messages.push(json!({"role": "user", "content": text}));
                } else {
                    let mut content: Vec<Value> = images.iter().map(image_block).collect();
                    content.push(json!({"type": "text", "text": text}));
                    messages.push(json!({"role": "user", "content": content}));
                }
                i += 1;
            }
            AgentTurn::Assistant { text, .. } => {
                // Claude rejects an empty assistant message on replay, which would fail
                // every later send; the API merges the neighbours left adjacent.
                if !text.trim().is_empty() {
                    messages.push(json!({"role": "assistant", "content": text}));
                }
                i += 1;
            }
            AgentTurn::ToolCall { .. } | AgentTurn::ToolResult { .. } => {
                let mut tool_uses = Vec::new();
                let mut tool_results = Vec::new();
                while let Some(turn) = history.get(i) {
                    match turn {
                        // The next step's calls.
                        AgentTurn::ToolCall { .. } if !tool_results.is_empty() => break,
                        AgentTurn::ToolCall {
                            call_id,
                            name,
                            arguments,
                            reasoning,
                        } => {
                            // The step's thinking blocks, ahead of its first
                            // tool_use: thinking with tools needs them back,
                            // signatures untouched.
                            if tool_uses.is_empty() {
                                if let Some(Value::Array(blocks)) = reasoning {
                                    tool_uses.extend(blocks.iter().cloned());
                                }
                            }
                            let input: Value =
                                serde_json::from_str(arguments).unwrap_or_else(|_| json!({}));
                            tool_uses.push(json!({
                                "type": "tool_use",
                                "id": call_id,
                                "name": name,
                                "input": input,
                            }));
                            i += 1;
                        }
                        AgentTurn::ToolResult {
                            call_id,
                            output,
                            images,
                        } => {
                            // A tool_result takes image blocks next to its
                            // text, so a tool's images stay in its result.
                            let content = if images.is_empty() {
                                json!(output)
                            } else {
                                let mut blocks = vec![json!({"type": "text", "text": output})];
                                blocks.extend(images.iter().map(image_block));
                                Value::Array(blocks)
                            };
                            tool_results.push(json!({
                                "type": "tool_result",
                                "tool_use_id": call_id,
                                "content": content,
                            }));
                            i += 1;
                        }
                        _ => break,
                    }
                }
                if !tool_uses.is_empty() {
                    messages.push(json!({"role": "assistant", "content": tool_uses}));
                }
                if !tool_results.is_empty() {
                    messages.push(json!({"role": "user", "content": tool_results}));
                }
            }
        }
    }
    messages
}

pub(crate) const EPHEMERAL: &str = "ephemeral";

/// Makes the last content block of `message` a cache breakpoint. A plain
/// string `content` becomes the one text block it stands for, so the cache
/// entry still matches once the marker moves on.
pub(crate) fn mark_cache_breakpoint(message: &mut Value) {
    let content = &mut message["content"];
    if let Some(text) = content.as_str() {
        *content = json!([{"type": "text", "text": text}]);
    }
    if let Some(last) = content.as_array_mut().and_then(|blocks| blocks.last_mut()) {
        last["cache_control"] = json!({"type": EPHEMERAL});
    }
}

/// [`turns_to_messages`] with the conversation's two cache breakpoints.
///
/// The message being sent carries the document and history keeps it
/// without, so only the history is shared by later requests. The first
/// breakpoint goes on its last block; the second on the last block before
/// the newest exchange, where the previous request put its first, so that
/// entry is read back however many blocks the exchange added.
pub(crate) fn messages_with_cache_breakpoints(history: &[AgentTurn]) -> Vec<Value> {
    let is_user = |turn: &AgentTurn| matches!(turn, AgentTurn::User { .. });
    let Some(current) = history.iter().rposition(is_user) else {
        return turns_to_messages(history);
    };
    let newest = history[..current].iter().rposition(is_user).unwrap_or(0);
    // Each slice starts at a user turn, which no message spans, so rendering
    // them one by one gives the same messages as rendering them together.
    let mut messages = turns_to_messages(&history[..newest]);
    if let Some(last) = messages.last_mut() {
        mark_cache_breakpoint(last);
    }
    messages.extend(turns_to_messages(&history[newest..current]));
    if let Some(last) = messages.last_mut() {
        mark_cache_breakpoint(last);
    }
    messages.extend(turns_to_messages(&history[current..]));
    messages
}

/// One agent step's Messages API body, with three explicit cache breakpoints
/// plus the automatic one (the API's limit of four): the last system block,
/// the two in the history, and the top-level one that follows the request's
/// end so each tool step reads the step before it from cache.
pub(crate) fn agent_request_body(
    auth: &AnthropicAuth,
    instructions: &str,
    history: &[AgentTurn],
    tools: &[ToolSpec],
    web_search: bool,
    thinking: &Thinking,
    model: &str,
) -> (Value, bool) {
    let mut system: Vec<Value> = system_blocks(instructions.to_string(), auth)
        .iter()
        .map(|b| json!({"type": b.kind, "text": b.text}))
        .collect();
    if let Some(last) = system.last_mut() {
        last["cache_control"] = json!({"type": EPHEMERAL});
    }
    let mut tool_schemas = tools.iter().map(tool_to_schema).collect::<Vec<_>>();
    // Claude executes this server tool inside the Messages request. Newer
    // versions route the search through code execution by default; this one
    // searches directly, on every model.
    if web_search {
        tool_schemas.push(json!({
            "type": "web_search_20250305",
            "name": "web_search",
            "max_uses": 5,
        }));
    }
    let mut body = json!({
        "model": model,
        // Room for a rewritten section inside one propose_edit call. Deep
        // thinking spends from the same limit, so it gets twice the room.
        "max_tokens": if thinking.show { DEEP_MAX_TOKENS } else { AGENT_MAX_TOKENS },
        "stream": true,
        "system": system,
        "messages": messages_with_cache_breakpoints(history),
        "tools": tool_schemas,
        "cache_control": {"type": EPHEMERAL},
    });
    let binding_beta = thinking.apply_anthropic(&mut body);
    (body, binding_beta)
}

/// Parses a Messages API `content` block array into a [`StepResult`]. Text
/// blocks are joined as they stand, since a cited reply comes as many short
/// blocks; text after a server block starts a new paragraph. A tool step's
/// thinking blocks ride on its first call, verbatim.
pub(crate) fn parse_agent_response(content: &[Value], on_event: EventSink<'_>) -> StepResult {
    let mut tool_calls = Vec::new();
    let mut text = String::new();
    let mut after_other_block = false;
    let mut citations = StepCitations::default();
    let mut thinking = Vec::new();

    for block in content {
        match block.get("type").and_then(|t| t.as_str()) {
            Some("tool_use") => {
                let call_id = block.get("id").and_then(|v| v.as_str()).unwrap_or_default();
                let name = block
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default();
                let arguments = block
                    .get("input")
                    .cloned()
                    .unwrap_or_else(|| json!({}))
                    .to_string();
                tool_calls.push(AgentTurn::ToolCall {
                    call_id: call_id.to_string(),
                    name: name.to_string(),
                    arguments,
                    reasoning: None,
                });
            }
            Some("thinking" | "redacted_thinking") => thinking.push(block.clone()),
            Some("text") => {
                if after_other_block && !text.trim().is_empty() {
                    text.push_str("\n\n");
                }
                after_other_block = false;
                text.push_str(block.get("text").and_then(|t| t.as_str()).unwrap_or(""));
                for citation in block
                    .get("citations")
                    .and_then(|c| c.as_array())
                    .into_iter()
                    .flatten()
                {
                    let Some(url) = citation.get("url").and_then(|u| u.as_str()) else {
                        continue;
                    };
                    let title = citation.get("title").and_then(|t| t.as_str()).unwrap_or("");
                    let marker = citations.cite(url, title, on_event);
                    if !text.ends_with(&marker) {
                        text.push_str(&marker);
                    }
                }
            }
            _ => after_other_block = true,
        }
    }

    if !tool_calls.is_empty() {
        if let (Some(AgentTurn::ToolCall { reasoning, .. }), false) =
            (tool_calls.first_mut(), thinking.is_empty())
        {
            *reasoning = Some(Value::Array(thinking));
        }
        StepResult::calls_with_text(tool_calls, text)
    } else {
        StepResult::Done(text)
    }
}
