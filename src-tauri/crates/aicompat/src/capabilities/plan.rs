//! The thinking a request asks for: a level turned into the effort,
//! budget or switch the provider and model take.

use super::*;

/// The thinking-token budget Deep asks for where a model takes a budget
/// rather than levels (Qwen, older Claude). A starting value, to be tuned
/// with the live eval.
pub const DEEP_BUDGET: u32 = 16_384;

/// One request's thinking parameters, dialect-neutral; each dialect renders
/// the parts it has a field for (`apply_*`). Empty for Auto: nothing sent.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Thinking {
    pub format: Option<ThinkingFormat>,
    /// Switch thinking on or off, where the model can.
    pub on: Option<bool>,
    pub effort: Option<String>,
    pub budget: Option<u32>,
    /// Ask for readable reasoning (OpenAI's summary, Claude's summarized
    /// display) - what the "Thinking" row can show.
    pub show: bool,
    /// See [`ProviderCaps::replay_reasoning`].
    pub replay: bool,
    /// Live eval only: opt the Claude request into the preserved-thinking
    /// check (`block_binding: error`), so a thinking block replayed after a
    /// history edit fails the run instead of being let through on an
    /// account created before the check was enforced.
    pub enforce_binding: bool,
}

impl Thinking {
    /// Whether any parameter would be sent.
    pub fn sends_parameters(&self) -> bool {
        self.on.is_some() || self.effort.is_some() || self.budget.is_some() || self.show
    }

    /// The same request with no thinking parameters - what a provider that
    /// refused them gets.
    pub fn without_parameters(&self) -> Thinking {
        Thinking {
            format: self.format,
            replay: self.replay,
            ..Thinking::default()
        }
    }

    /// Chat Completions: the format's fields, on the top level of `body`.
    pub fn apply_chat_completions(&self, body: &mut Value) {
        match self.format {
            Some(ThinkingFormat::OpenAi) => {
                if let Some(effort) = self.wire_effort() {
                    body["reasoning_effort"] = json!(effort);
                }
            }
            Some(ThinkingFormat::ThinkingType) => {
                if let Some(on) = self.on {
                    body["thinking"] = json!({"type": if on { "enabled" } else { "disabled" }});
                }
                if self.on != Some(false) {
                    if let Some(effort) = &self.effort {
                        body["reasoning_effort"] = json!(effort);
                    }
                }
            }
            Some(ThinkingFormat::Qwen) => self.apply_qwen(body),
            Some(ThinkingFormat::OpenRouter) => {
                if self.on == Some(false) {
                    body["reasoning"] = json!({"enabled": false});
                } else if let Some(effort) = &self.effort {
                    body["reasoning"] = json!({"effort": effort});
                } else if self.on == Some(true) {
                    body["reasoning"] = json!({"enabled": true});
                }
            }
            Some(ThinkingFormat::Anthropic | ThinkingFormat::None) | None => {}
        }
    }

    /// Responses API (OpenAI's, and the compatible `/responses` of xAI and
    /// Qwen): `reasoning.effort`, with `reasoning.summary` when the
    /// reasoning should be readable. Qwen keeps its own switch there too.
    pub fn apply_responses(&self, body: &mut Value) {
        if self.format == Some(ThinkingFormat::Qwen) {
            self.apply_qwen(body);
            return;
        }
        if !matches!(self.format, Some(ThinkingFormat::OpenAi)) {
            return;
        }
        let mut reasoning = serde_json::Map::new();
        if let Some(effort) = self.wire_effort() {
            reasoning.insert("effort".into(), json!(effort));
        }
        if self.show {
            reasoning.insert("summary".into(), json!("auto"));
        }
        if !reasoning.is_empty() {
            body["reasoning"] = Value::Object(reasoning);
        }
    }

    /// Anthropic Messages: `thinking` and `output_config.effort`, plus room
    /// in `max_tokens` for what the thinking itself uses. Returns whether
    /// the request needs the preserved-thinking controls beta header.
    pub fn apply_anthropic(&self, body: &mut Value) -> bool {
        if self.format != Some(ThinkingFormat::Anthropic) {
            return false;
        }
        if self.on == Some(false) {
            body["thinking"] = json!({"type": "disabled"});
            return false;
        }
        let mut thinking = None;
        if let Some(budget) = self.budget {
            // Older models: a fixed budget, which max_tokens must exceed.
            thinking = Some(json!({"type": "enabled", "budget_tokens": budget}));
            let max = body["max_tokens"].as_u64().unwrap_or(0);
            body["max_tokens"] = json!(max + u64::from(budget));
        } else if self.show || self.effort.is_some() || self.enforce_binding {
            let mut adaptive = json!({"type": "adaptive"});
            if self.show {
                adaptive["display"] = json!("summarized");
            }
            thinking = Some(adaptive);
        }
        if let Some(effort) = &self.effort {
            body["output_config"] = json!({"effort": effort});
        }
        let enforce = self.enforce_binding && thinking.is_some() && self.budget.is_none();
        if let Some(mut thinking) = thinking {
            if enforce {
                thinking["block_binding"] = json!({"prefix_mismatch_behavior": "error"});
            }
            body["thinking"] = thinking;
        }
        enforce
    }

    pub(crate) fn apply_qwen(&self, body: &mut Value) {
        if let Some(on) = self.on {
            body["enable_thinking"] = json!(on);
        }
        if self.on != Some(false) {
            if let Some(budget) = self.budget {
                body["thinking_budget"] = json!(budget);
            }
        }
    }

    /// The effort as an OpenAI-format field: switching off is `none`.
    pub(crate) fn wire_effort(&self) -> Option<&str> {
        match (self.on, &self.effort) {
            (Some(false), _) => Some("none"),
            (_, Some(effort)) => Some(effort),
            _ => None,
        }
    }
}

/// The beta header that lets a Claude request set `block_binding`.
pub const THINKING_BINDING_BETA: &str = "thinking-binding-controls-2026-08-01";

/// The effort Deep asks for: `high`, or the strongest level below `xhigh`
/// the model has.
pub(crate) fn deep_effort(efforts: &[String]) -> Option<String> {
    if efforts.iter().any(|e| e == "high") {
        return Some("high".into());
    }
    efforts
        .iter()
        .rfind(|e| !matches!(e.as_str(), "none" | "xhigh" | "max"))
        .cloned()
}

/// What `level` sends to `model` on `provider_id`. Nothing for Auto, for a
/// format that takes nothing, and for a model that refused thinking
/// parameters earlier this session.
pub fn plan(provider_id: &str, model: &str, level: ThinkingLevel) -> Thinking {
    let caps = provider(provider_id);
    let base = Thinking {
        format: Some(caps.thinking),
        replay: caps.replay_reasoning,
        ..Thinking::default()
    };
    if caps.thinking == ThinkingFormat::None || refused(provider_id, model) {
        return base;
    }
    let reasoning = model_reasoning(provider_id, model);
    if level == ThinkingLevel::Auto {
        return match (caps.auto_effort, &reasoning) {
            (Some(effort), ModelReasoning::Options { efforts, .. })
                if efforts.iter().any(|e| e == effort) =>
            {
                Thinking {
                    effort: Some(effort.into()),
                    ..base
                }
            }
            _ => base,
        };
    }
    match (level, reasoning) {
        (_, ModelReasoning::No | ModelReasoning::Fixed) => base,
        // Unknown: Fast leaves the provider's default alone; Deep asks the
        // way the provider's format usually takes it.
        (ThinkingLevel::Fast, ModelReasoning::Unknown) => base,
        (_, ModelReasoning::Unknown) => match caps.thinking {
            ThinkingFormat::ThinkingType | ThinkingFormat::Qwen => Thinking {
                on: Some(true),
                ..base
            },
            _ => Thinking {
                effort: Some("high".into()),
                show: true,
                ..base
            },
        },
        (
            ThinkingLevel::Fast,
            ModelReasoning::Options {
                toggle, efforts, ..
            },
        ) => {
            // Off where the model can be switched off, by the switch or
            // as the effort `none`.
            if toggle || efforts.iter().any(|e| e == "none") {
                Thinking {
                    on: Some(false),
                    ..base
                }
            } else {
                Thinking {
                    effort: efforts.first().cloned(),
                    ..base
                }
            }
        }
        (
            _,
            ModelReasoning::Options {
                toggle,
                efforts,
                budget,
            },
        ) => {
            let effort = deep_effort(&efforts);
            // A budget only where there is no level to ask for (or the
            // format has no field for levels): Qwen, and pre-adaptive Claude.
            let budget = budget
                .filter(|_| effort.is_none() || caps.thinking == ThinkingFormat::Qwen)
                .map(|max| u64::from(DEEP_BUDGET).min(max) as u32);
            Thinking {
                on: toggle.then_some(true),
                effort,
                budget,
                show: true,
                ..base
            }
        }
    }
}
