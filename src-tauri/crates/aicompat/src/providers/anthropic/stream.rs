//! A streamed reply put together event by event: its text, thinking and
//! tool calls, block by block.

use super::*;

/// One in-flight content block while a streamed Messages response is being
/// read.
pub(crate) enum StreamBlock {
    Text {
        text: String,
        /// Where a web search result backs the text (citations_delta).
        citations: Vec<Value>,
    },
    /// Readable (or, by default, empty) thinking and the signature that
    /// lets it be sent back.
    Thinking {
        text: String,
        signature: String,
    },
    /// Thinking Claude returned encrypted - sent back as it came.
    Redacted(Value),
    ToolUse {
        id: String,
        name: String,
        /// input_json_delta fragments, concatenated - parsed once at the end.
        args: String,
    },
    /// Any other block - a server_tool_use (web search) and its result -
    /// kept whole, as the API sent it: parse_agent_response doesn't read
    /// them, but a paused turn is continued by sending them back unchanged.
    Other {
        block: Value,
        /// A server_tool_use's input, as input_json_delta fragments.
        args: String,
    },
    Ignored,
}

/// Rebuilds the non-streaming response's `content` array from Messages API SSE
/// events, reporting fragments through `on_event` as they arrive.
#[derive(Default)]
pub(crate) struct StreamAccumulator {
    pub(crate) blocks: Vec<StreamBlock>,
    pub(crate) error: Option<String>,
    pub(crate) stop_reason: Option<String>,
    pub(crate) usage: StepUsage,
}

impl StreamAccumulator {
    pub(crate) fn block_at(&mut self, index: usize) -> &mut StreamBlock {
        while self.blocks.len() <= index {
            self.blocks.push(StreamBlock::Ignored);
        }
        &mut self.blocks[index]
    }

    pub(crate) fn apply(&mut self, data: &str, on_event: EventSink<'_>) {
        if self.error.is_some() {
            return;
        }
        let Ok(event) = serde_json::from_str::<Value>(data) else {
            return;
        };
        let index = event.get("index").and_then(|i| i.as_u64()).unwrap_or(0) as usize;

        match event.get("type").and_then(|t| t.as_str()) {
            Some("content_block_start") => {
                let Some(block) = event.get("content_block") else {
                    return;
                };
                match block.get("type").and_then(|t| t.as_str()) {
                    Some("text") => {
                        *self.block_at(index) = StreamBlock::Text {
                            text: String::new(),
                            citations: Vec::new(),
                        }
                    }
                    Some("thinking") => {
                        on_event(ProviderEvent::Thinking(""));
                        let field = |k: &str| {
                            block
                                .get(k)
                                .and_then(|v| v.as_str())
                                .unwrap_or_default()
                                .to_string()
                        };
                        *self.block_at(index) = StreamBlock::Thinking {
                            text: field("thinking"),
                            signature: field("signature"),
                        };
                    }
                    Some("redacted_thinking") => {
                        on_event(ProviderEvent::Thinking(""));
                        *self.block_at(index) = StreamBlock::Redacted(block.clone());
                    }
                    Some("tool_use") => {
                        let id = block.get("id").and_then(|v| v.as_str()).unwrap_or_default();
                        let name = block
                            .get("name")
                            .and_then(|v| v.as_str())
                            .unwrap_or_default();
                        on_event(ProviderEvent::ToolStart { call_id: id, name });
                        *self.block_at(index) = StreamBlock::ToolUse {
                            id: id.to_string(),
                            name: name.to_string(),
                            args: String::new(),
                        };
                    }
                    _ => {
                        *self.block_at(index) = StreamBlock::Other {
                            block: block.clone(),
                            args: String::new(),
                        }
                    }
                }
            }
            Some("content_block_delta") => {
                let Some(delta) = event.get("delta") else {
                    return;
                };
                match delta.get("type").and_then(|t| t.as_str()) {
                    Some("text_delta") => {
                        let Some(text) = delta.get("text").and_then(|t| t.as_str()) else {
                            return;
                        };
                        if let StreamBlock::Text { text: buf, .. } = self.block_at(index) {
                            buf.push_str(text);
                            on_event(ProviderEvent::Text(text));
                        }
                    }
                    Some("citations_delta") => {
                        if let (Some(citation), StreamBlock::Text { citations, .. }) =
                            (delta.get("citation"), self.block_at(index))
                        {
                            citations.push(citation.clone());
                        }
                    }
                    Some("thinking_delta") => {
                        let Some(part) = delta.get("thinking").and_then(|t| t.as_str()) else {
                            return;
                        };
                        if let StreamBlock::Thinking { text, .. } = self.block_at(index) {
                            text.push_str(part);
                            on_event(ProviderEvent::Thinking(part));
                        }
                    }
                    Some("signature_delta") => {
                        let Some(part) = delta.get("signature").and_then(|t| t.as_str()) else {
                            return;
                        };
                        if let StreamBlock::Thinking { signature, .. } = self.block_at(index) {
                            signature.push_str(part);
                        }
                    }
                    Some("input_json_delta") => {
                        let Some(part) = delta.get("partial_json").and_then(|t| t.as_str()) else {
                            return;
                        };
                        match self.block_at(index) {
                            StreamBlock::ToolUse { id, args, .. } => {
                                args.push_str(part);
                                let call_id = id.clone();
                                on_event(ProviderEvent::ToolArgs {
                                    call_id: &call_id,
                                    delta: part,
                                });
                            }
                            StreamBlock::Other { args, .. } => args.push_str(part),
                            _ => {}
                        }
                    }
                    _ => {}
                }
            }
            Some("message_start") => {
                if let Some(usage) = event.pointer("/message/usage") {
                    let n = |k: &str| usage.get(k).and_then(|v| v.as_u64()).unwrap_or(0);
                    self.usage.input_tokens = n("input_tokens");
                    self.usage.cache_creation_input_tokens = n("cache_creation_input_tokens");
                    self.usage.cache_read_input_tokens = n("cache_read_input_tokens");
                }
            }
            Some("message_delta") => {
                if let Some(out) = event
                    .pointer("/usage/output_tokens")
                    .and_then(|v| v.as_u64())
                {
                    self.usage.output_tokens = out;
                }
                if let Some(reason) = event.pointer("/delta/stop_reason").and_then(|r| r.as_str()) {
                    self.stop_reason = Some(reason.to_string());
                }
            }
            Some("error") => {
                let error = event.get("error").cloned().unwrap_or(event.clone());
                self.error = Some(format!("Claude request failed: {error}"));
            }
            _ => {}
        }
    }

    /// The response's content blocks, as the API would have sent them
    /// whole.
    pub(crate) fn into_content(self) -> Vec<Value> {
        self.blocks
            .into_iter()
            .filter_map(|block| match block {
                StreamBlock::Text { text, citations } if citations.is_empty() => {
                    Some(json!({"type": "text", "text": text}))
                }
                StreamBlock::Text { text, citations } => {
                    Some(json!({"type": "text", "text": text, "citations": citations}))
                }
                StreamBlock::Thinking { text, signature } => Some(json!({
                    "type": "thinking",
                    "thinking": text,
                    "signature": signature,
                })),
                StreamBlock::Redacted(block) => Some(block),
                StreamBlock::ToolUse { id, name, args } => {
                    let input: Value = serde_json::from_str(&args).unwrap_or_else(|_| json!({}));
                    Some(json!({"type": "tool_use", "id": id, "name": name, "input": input}))
                }
                StreamBlock::Other { mut block, args } => {
                    if !args.is_empty() {
                        block["input"] = serde_json::from_str(&args).unwrap_or_else(|_| json!({}));
                    }
                    Some(block)
                }
                StreamBlock::Ignored => None,
            })
            .collect()
    }
}
