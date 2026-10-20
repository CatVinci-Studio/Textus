//! One agent step against whichever provider a request goes to. Each
//! dialect module knows its own wire format; this is the one place that
//! picks the dialect, plans the step's thinking parameters (and drops them
//! when the provider refuses them), and turns the provider's own web search
//! on in the shape that dialect takes - so the main crate's agent has a
//! single path from "the user's provider" to `run_agent_loop`'s `step`.

use crate::agent::{AgentTurn, EventSink, StepResult, StepUsage, ToolSpec};
use crate::capabilities::{self, NativeSearch, Thinking, ThinkingLevel};
use crate::providers::anthropic::{self, AnthropicAuth};
use crate::providers::{custom, openai_api_key, openai_codex, openai_responses_compatible};

/// Where an agent step goes, with the credentials it needs.
#[derive(Clone)]
pub enum Endpoint {
    /// ChatGPT sign-in: the ChatGPT backend's Responses API.
    Codex {
        access_token: String,
        account_id: String,
        /// The `originator` header the ChatGPT backend expects.
        originator: String,
    },
    /// The public OpenAI Responses API, with an API key.
    OpenaiApiKey { api_key: String },
    /// Claude's Messages API, by sign-in or API key.
    Anthropic { auth: AnthropicAuth },
    /// An OpenAI-compatible Chat Completions server - a catalog provider or
    /// the user's custom endpoint.
    ChatCompletions {
        base_url: String,
        api_key: Option<String>,
        vendor: custom::Vendor,
        /// See `ProviderCaps::stream_usage`.
        stream_usage: bool,
    },
}

/// The provider, model and settings one agent request runs on. Built once
/// per request; [`AgentProvider::step`] is what the loop calls each step.
#[derive(Clone)]
pub struct AgentProvider {
    /// The catalog id - the capability table's key for thinking and search.
    pub id: String,
    pub model: String,
    pub endpoint: Endpoint,
    /// How hard the model thinks, planned per step (a refusal earlier in the
    /// session changes the plan).
    pub thinking: ThinkingLevel,
    /// The provider's own web search, when the request searches with it.
    pub native_search: Option<NativeSearch>,
    /// Live eval only: see [`Thinking::enforce_binding`].
    pub enforce_binding: bool,
}

impl AgentProvider {
    /// Whether a request that fails on this provider is answered again
    /// without tools. Not every OpenAI-compatible server implements `tools`
    /// correctly (some 400 on it, some silently ignore it and never call
    /// one); the first-party APIs do, and their errors are real ones.
    pub fn falls_back_to_plain_chat(&self) -> bool {
        matches!(self.endpoint, Endpoint::ChatCompletions { .. })
    }

    /// One round trip: the model's answer to `history`, streamed through
    /// `on_event`, and the step's token usage, where the provider reports it
    /// (Claude always; the OpenAI-style APIs in their `usage`). Thinking parameters the provider refuses are dropped and
    /// the step sent again (capabilities::with_fallback).
    pub async fn step(
        &self,
        instructions: &str,
        history: &[AgentTurn],
        tools: &[ToolSpec],
        on_event: EventSink<'_>,
    ) -> Result<(StepResult, Option<StepUsage>), String> {
        let plan = Thinking {
            enforce_binding: self.enforce_binding,
            ..capabilities::plan(&self.id, &self.model, self.thinking)
        };
        capabilities::with_fallback(&self.id, &self.model, &plan, |plan| async move {
            self.step_once(instructions, history, tools, &plan, on_event)
                .await
        })
        .await
    }

    async fn step_once(
        &self,
        instructions: &str,
        history: &[AgentTurn],
        tools: &[ToolSpec],
        thinking: &Thinking,
        on_event: EventSink<'_>,
    ) -> Result<(StepResult, Option<StepUsage>), String> {
        let model = self.model.as_str();
        let searches = self.native_search.is_some();
        let step = match &self.endpoint {
            Endpoint::Codex {
                access_token,
                account_id,
                originator,
            } => {
                openai_codex::agent_step(
                    access_token,
                    account_id,
                    originator,
                    instructions,
                    history,
                    tools,
                    searches,
                    thinking,
                    model,
                    on_event,
                )
                .await
            }
            Endpoint::OpenaiApiKey { api_key } => {
                openai_api_key::agent_step(
                    api_key,
                    instructions,
                    history,
                    tools,
                    searches,
                    thinking,
                    model,
                    on_event,
                )
                .await
            }
            Endpoint::Anthropic { auth } => {
                return anthropic::agent_step(
                    auth,
                    instructions,
                    history,
                    tools,
                    searches,
                    thinking,
                    model,
                    on_event,
                )
                .await
                .map(|(step, usage)| (step, Some(usage)));
            }
            Endpoint::ChatCompletions {
                base_url,
                api_key,
                vendor,
                stream_usage,
            } => {
                let api_key = api_key.as_deref();
                // xAI searches only on its /responses endpoint.
                if self.native_search == Some(NativeSearch::CompatibleResponses) {
                    openai_responses_compatible::agent_step(
                        base_url,
                        api_key,
                        model,
                        instructions,
                        history,
                        tools,
                        true,
                        thinking,
                        on_event,
                    )
                    .await
                } else {
                    let native = match self.native_search {
                        Some(NativeSearch::ChatCompletions(switch)) => Some(switch),
                        _ => None,
                    };
                    // `stream` support varies across OpenAI-compatible
                    // servers even more than `tools` does, so a failed
                    // streamed step is retried once without streaming (and
                    // without thinking parameters, which some servers take
                    // only when streaming) before the plain-chat fallback
                    // gets a say. A genuine model/auth error just fails
                    // twice cheaply and surfaces the second (identical)
                    // error.
                    match custom::agent_step_streaming(
                        base_url,
                        api_key,
                        model,
                        instructions,
                        history,
                        tools,
                        native,
                        *vendor,
                        thinking,
                        *stream_usage,
                        on_event,
                    )
                    .await
                    {
                        Ok(result) => Ok(result),
                        Err(error) if capabilities::is_thinking_refusal(&error) => Err(error),
                        Err(_) => {
                            custom::agent_step(
                                base_url,
                                api_key,
                                model,
                                instructions,
                                history,
                                tools,
                                native,
                                *vendor,
                                &thinking.without_parameters(),
                                on_event,
                            )
                            .await
                        }
                    }
                }
            }
        };
        step
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn on(endpoint: Endpoint) -> AgentProvider {
        AgentProvider {
            id: "test".into(),
            model: "m".into(),
            endpoint,
            thinking: ThinkingLevel::Auto,
            native_search: None,
            enforce_binding: false,
        }
    }

    #[test]
    fn only_compatible_servers_fall_back_to_plain_chat() {
        assert!(on(Endpoint::ChatCompletions {
            base_url: "http://localhost:11434/v1".into(),
            api_key: None,
            vendor: custom::Vendor::Generic,
            stream_usage: false,
        })
        .falls_back_to_plain_chat());
        assert!(!on(Endpoint::Anthropic {
            auth: AnthropicAuth::ApiKey("k".into()),
        })
        .falls_back_to_plain_chat());
        assert!(!on(Endpoint::OpenaiApiKey {
            api_key: "k".into()
        })
        .falls_back_to_plain_chat());
    }
}
