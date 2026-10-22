//! An agent step's request body - the conversation as chat messages, the
//! tools, the vendor's own fields - and a whole reply read back.

use super::*;

// --- Agentic tool-calling support (the generic openai-chat-completions
// dialect - see `aicompat::agent` for the provider-agnostic loop this
// feeds). This is the dialect self-hosted models, OpenRouter, Groq, Ollama,
// and most other OpenAI-compatible servers speak - unlike the Responses API
// and Messages API dialects, `tools` support here varies a lot server to
// server, so the caller (agent.rs) is expected to fall back to
// `call_completion` on a hard failure rather than this module guessing.

pub(crate) fn tool_to_schema(tool: &ToolSpec) -> Value {
    json!({
        "type": "function",
        "function": {
            "name": tool.name,
            "description": tool.description,
            "parameters": tool.parameters,
        },
    })
}

/// Provider-specific web search switches that are accepted by otherwise
/// OpenAI-compatible Chat Completions endpoints.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum NativeWebSearch {
    Groq,
    OpenRouter,
    Qwen,
    Zhipu,
}

pub(crate) fn agent_request_body(
    model: &str,
    instructions: &str,
    history: &[AgentTurn],
    tools: &[ToolSpec],
    web_search: Option<NativeWebSearch>,
    vendor: Vendor,
    thinking: &Thinking,
) -> Value {
    let mut tool_schemas = tools.iter().map(tool_to_schema).collect::<Vec<_>>();
    match web_search {
        Some(NativeWebSearch::Groq) => {
            tool_schemas.push(json!({"type": "browser_search"}));
        }
        Some(NativeWebSearch::OpenRouter) => {
            tool_schemas.push(json!({"type": "openrouter:web_search"}));
        }
        Some(NativeWebSearch::Zhipu) => {
            tool_schemas.push(json!({
                "type": "web_search",
                "web_search": {"enable": true, "search_result": true},
            }));
        }
        Some(NativeWebSearch::Qwen) | None => {}
    }

    let mut body = json!({
        "model": model,
        "messages": turns_to_messages(instructions, history, thinking.replay),
        "tools": tool_schemas,
        "tool_choice": "auto",
    });
    if web_search == Some(NativeWebSearch::Qwen) {
        body["enable_search"] = json!(true);
    }
    if vendor == Vendor::Ark {
        body["max_tokens"] = json!(ARK_AGENT_MAX_TOKENS);
    }
    if vendor == Vendor::MiniMax {
        body["reasoning_split"] = json!(true);
    }
    thinking.apply_chat_completions(&mut body);
    body
}

/// A user message of image parts, then `text`.
pub(crate) fn user_message_with_images(images: &[ImageAttachment], text: &str) -> Value {
    let mut content: Vec<Value> = images
        .iter()
        .map(|image| {
            json!({
                "type": "image_url",
                "image_url": {"url": image.data_url()},
            })
        })
        .collect();
    content.push(json!({"type": "text", "text": text}));
    json!({"role": "user", "content": content})
}

/// Groups the flat `AgentTurn` history into Chat Completions messages.
/// Like the Anthropic dialect, every `ToolCall` of a step must land in ONE
/// assistant message's `tool_calls` array - but each `ToolResult` becomes
/// its OWN `role: "tool"` message afterward (not grouped into one, unlike
/// Anthropic's `tool_result` content blocks), matching what
/// api.openai.com/v1/chat/completions and compatible servers expect. A call
/// after a result starts the next step's message (`run_agent_loop` records
/// each step's calls before their results), so a new step only appends to
/// the messages and the servers that cache prompt prefixes on their own
/// (DeepSeek, Qwen, Kimi, ...) keep the earlier steps cached. With
/// `replay_reasoning`, a step's `reasoning_content` goes back on its
/// assistant message (see `ProviderCaps::replay_reasoning`).
pub(crate) fn turns_to_messages(
    instructions: &str,
    history: &[AgentTurn],
    replay_reasoning: bool,
) -> Vec<Value> {
    let mut messages = vec![json!({"role": "system", "content": instructions})];
    let mut i = 0;
    while i < history.len() {
        match &history[i] {
            AgentTurn::User { text, images } => {
                // Plain string `content` unless there are images: an
                // OpenAI-compatible server that predates vision accepts the
                // string form and may reject the content-part array, and the
                // overwhelming majority of turns have no images.
                if images.is_empty() {
                    messages.push(json!({"role": "user", "content": text}));
                } else {
                    messages.push(user_message_with_images(images, text));
                }
                i += 1;
            }
            AgentTurn::Assistant { text, .. } => {
                messages.push(json!({"role": "assistant", "content": text}));
                i += 1;
            }
            AgentTurn::ToolCall { .. } | AgentTurn::ToolResult { .. } => {
                let mut tool_calls = Vec::new();
                let mut tool_results = Vec::new();
                let mut tool_images = Vec::new();
                let mut reasoning = None;
                while let Some(turn) = history.get(i) {
                    match turn {
                        // The next step's calls.
                        AgentTurn::ToolCall { .. } if !tool_results.is_empty() => break,
                        AgentTurn::ToolCall {
                            call_id,
                            name,
                            arguments,
                            reasoning: step_reasoning,
                        } => {
                            let (text, extra) = kept_parts(step_reasoning.as_ref());
                            if reasoning.is_none() {
                                reasoning = text;
                            }
                            let mut call = json!({
                                "id": call_id,
                                "type": "function",
                                "function": { "name": name, "arguments": arguments },
                            });
                            if let Some(extra) = extra {
                                call[EXTRA_CONTENT] = extra.clone();
                            }
                            tool_calls.push(call);
                            i += 1;
                        }
                        AgentTurn::ToolResult {
                            call_id,
                            output,
                            images,
                        } => {
                            tool_results.push((call_id.clone(), output.clone()));
                            tool_images.extend(images.iter().cloned());
                            i += 1;
                        }
                        _ => break,
                    }
                }
                if !tool_calls.is_empty() {
                    let mut message = json!({"role": "assistant", "content": Value::Null, "tool_calls": tool_calls});
                    if let Some(reasoning) = reasoning.filter(|_| replay_reasoning) {
                        message["reasoning_content"] = json!(reasoning);
                    }
                    messages.push(message);
                }
                for (call_id, output) in tool_results {
                    messages
                        .push(json!({"role": "tool", "tool_call_id": call_id, "content": output}));
                }
                // A `tool` message's content is text only (OpenAI's own
                // API rejects image parts there, and the compatible servers
                // follow it), so the step's images follow its results as
                // one user message.
                if !tool_images.is_empty() {
                    let note = tool_images_note(&tool_images);
                    messages.push(user_message_with_images(&tool_images, &note));
                }
            }
        }
    }
    messages
}

/// Parses a Chat Completions `choices[0].message` object into a
/// [`StepResult`]: any `tool_calls` become tool calls the caller must
/// execute, otherwise `content` is the model's final answer, with the
/// pages a native search cited (`report`) marked and reported.
pub(crate) fn parse_agent_response(
    message: &Value,
    report: &SearchReport,
    on_event: EventSink<'_>,
) -> StepResult {
    let mut calls: Vec<AgentTurn> = message
        .get("tool_calls")
        .and_then(|v| v.as_array())
        .into_iter()
        .flatten()
        .filter_map(|tc| {
            let call_id = tc
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            let func = tc.get("function")?;
            let name = func.get("name")?.as_str()?.to_string();
            let arguments = func
                .get("arguments")
                .and_then(|a| a.as_str())
                .unwrap_or("{}")
                .to_string();
            Some(AgentTurn::ToolCall {
                call_id,
                name,
                arguments,
                reasoning: tc.get("extra_content").cloned().map(call_extra),
            })
        })
        .collect();

    let text = message
        .get("content")
        .and_then(|c| c.as_str())
        .unwrap_or_default();
    if !calls.is_empty() {
        attach_reasoning(&mut calls, reasoning_of(message).unwrap_or_default());
        return StepResult::calls_with_text(calls, report.cite(text, on_event));
    }
    StepResult::Done(report.cite(text, on_event))
}

/// The reasoning an OpenAI-compatible message or delta carries: DeepSeek,
/// Kimi, Qwen and GLM call it `reasoning_content`; OpenRouter, Groq and
/// Ollama `reasoning`.
pub(crate) fn reasoning_of(message: &Value) -> Option<&str> {
    ["reasoning_content", "reasoning"]
        .iter()
        .find_map(|key| message.get(*key).and_then(|r| r.as_str()))
}

/// A step's reasoning rides on its first call (`AgentTurn::ToolCall`): the
/// `reasoning_content` string, or beside the call's [`call_extra`].
pub(crate) fn attach_reasoning(calls: &mut [AgentTurn], text: &str) {
    if text.is_empty() {
        return;
    }
    if let Some(AgentTurn::ToolCall { reasoning, .. }) = calls.first_mut() {
        match reasoning {
            Some(Value::Object(kept)) => {
                kept.insert(REASONING_CONTENT.into(), json!(text));
            }
            _ => *reasoning = Some(json!(text)),
        }
    }
}

const REASONING_CONTENT: &str = "reasoning_content";
const EXTRA_CONTENT: &str = "extra_content";

/// A call's `extra_content` as its turn keeps it. Gemini 3 sends a thought
/// signature there and refuses the next request when a call comes back
/// without it (400 "Function call is missing a thought_signature",
/// 1.2.0-rc.6); other servers send none, and their turns are as before.
pub(crate) fn call_extra(extra: Value) -> Value {
    json!({ EXTRA_CONTENT: extra })
}

/// A kept call's reasoning text and `extra_content`, from either shape
/// (`attach_reasoning`, `call_extra`).
fn kept_parts(kept: Option<&Value>) -> (Option<&str>, Option<&Value>) {
    match kept {
        Some(Value::String(text)) => (Some(text), None),
        Some(Value::Object(parts)) => (
            parts.get(REASONING_CONTENT).and_then(Value::as_str),
            parts.get(EXTRA_CONTENT),
        ),
        _ => (None, None),
    }
}
