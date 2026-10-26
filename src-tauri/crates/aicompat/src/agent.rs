use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::borrow::Cow;

mod citations;
pub use citations::*;
mod run;
pub use run::*;

/// An image riding along with a user turn. Images have no text to extract,
/// so they reach the model as the provider's own image content part.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ImageAttachment {
    pub name: String,
    pub mime: String,
    pub data_base64: String,
}

impl ImageAttachment {
    /// `data:image/png;base64,...` - the form both OpenAI dialects want.
    pub fn data_url(&self) -> String {
        format!("data:{};base64,{}", self.mime, self.data_base64)
    }
}

/// One entry in an agent conversation, kept provider-agnostic.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(tag = "kind")]
pub enum AgentTurn {
    User {
        text: String,
        /// Defaulted so conversations saved before images existed still deserialize.
        #[serde(default)]
        images: Vec<ImageAttachment>,
    },
    Assistant {
        text: String,
        /// The web pages the reply cites as [n], numbered once per conversation.
        /// Defaulted and skipped when empty so older saves still deserialize.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        sources: Vec<Source>,
    },
    ToolCall {
        call_id: String,
        name: String,
        arguments: String,
        /// The model's reasoning for the step this call opens, in the provider's
        /// wire shape, on the step's first call only. Thinking with tools requires
        /// it sent back; it never outlives the exchange.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        reasoning: Option<Value>,
    },
    ToolResult {
        call_id: String,
        output: String,
        /// Images the tool showed the model, for the request in flight only. Each
        /// dialect delivers them in the tool result or as a user message after it.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        images: Vec<ImageAttachment>,
    },
}

/// One web page a reply cites as `[n]`. Exported as WebSource.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "specta", derive(specta::Type), serde(rename = "WebSource"))]
pub struct Source {
    pub n: u32,
    pub url: String,
    pub title: String,
}

impl AgentTurn {
    /// A final reply that cites no web sources.
    pub fn assistant(text: impl Into<String>) -> Self {
        AgentTurn::Assistant {
            text: text.into(),
            sources: Vec::new(),
        }
    }
}

/// What a tool returns to the loop: text, and any images it shows the
/// model. A plain `String` converts, so tools without images return text.
#[derive(Clone, Debug, Default)]
pub struct ToolOutput {
    pub text: String,
    pub images: Vec<ImageAttachment>,
    /// The call's arguments as they are to be recorded, for a
    /// [`ToolRun::Amending`] tool.
    pub call_arguments: Option<String>,
    /// The call needs nothing more from the model. When every call of a step
    /// is settled and the model wrote its reply with them, the loop ends.
    pub settled: bool,
    /// Settled only beside other calls: a step of this call alone goes on to
    /// one more step, since a lone one means the model meant to go on.
    pub settles_with_others: bool,
}

impl From<String> for ToolOutput {
    fn from(text: String) -> Self {
        Self {
            text,
            ..Self::default()
        }
    }
}

/// Token accounting for one agent step: uncached input, input written to
/// the cache (Claude only), input read from it, and output.
#[derive(Default, Debug, Clone, Copy, PartialEq, Eq)]
pub struct StepUsage {
    pub input_tokens: u64,
    pub cache_creation_input_tokens: u64,
    pub cache_read_input_tokens: u64,
    pub output_tokens: u64,
}

impl StepUsage {
    pub fn add(&mut self, other: StepUsage) {
        self.input_tokens += other.input_tokens;
        self.cache_creation_input_tokens += other.cache_creation_input_tokens;
        self.cache_read_input_tokens += other.cache_read_input_tokens;
        self.output_tokens += other.output_tokens;
    }

    /// An OpenAI-style `usage` object, Chat Completions or Responses. Both
    /// count cached input inside the input total; providers name the cached
    /// part differently. None when there is no usage to read.
    pub fn from_openai(usage: &Value) -> Option<StepUsage> {
        let n = |path: &str| usage.pointer(path).and_then(Value::as_u64);
        let input = n("/prompt_tokens").or_else(|| n("/input_tokens"))?;
        let cached = n("/prompt_tokens_details/cached_tokens")
            .or_else(|| n("/input_tokens_details/cached_tokens"))
            .or_else(|| n("/prompt_cache_hit_tokens"))
            .or_else(|| n("/cached_tokens"))
            .unwrap_or(0)
            .min(input);
        Some(StepUsage {
            input_tokens: input - cached,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: cached,
            output_tokens: n("/completion_tokens")
                .or_else(|| n("/output_tokens"))
                .unwrap_or(0),
        })
    }
}

/// One call [`run_agent_loop`] hands its `execute_tool`.
#[derive(Clone, Debug, Default)]
pub struct ToolCall {
    pub call_id: String,
    pub name: String,
    pub arguments: String,
}

/// How [`run_agent_loop`] runs a tool's calls.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ToolRun {
    /// It only reads: the calls of a step run at the same time, up to
    /// [`MAX_CONCURRENT_TOOLS`].
    Concurrent,
    /// It proposes or changes something: one call at a time, in the order
    /// the model sent them.
    InOrder,
    /// In order, and its output gives its call's final arguments
    /// ([`ToolOutput::call_arguments`]); a step with such a call reports
    /// its calls once they have run.
    Amending,
}

/// How many read-only calls of one step run at once.
pub const MAX_CONCURRENT_TOOLS: usize = 4;

/// The text a user message carries next to images a tool showed, where the
/// dialect can't put them in the tool result, so the model reads them as
/// the tool's answer.
pub fn tool_images_note(images: &[ImageAttachment]) -> String {
    let names: Vec<&str> = images.iter().map(|i| i.name.as_str()).collect();
    format!(
        "(Opened by the tool call above, not sent by the user: {})",
        names.join(", ")
    )
}

/// A tool the model may call. `parameters` is a JSON schema object.
#[derive(Clone, Debug)]
pub struct ToolSpec {
    pub name: Cow<'static, str>,
    pub description: Cow<'static, str>,
    pub parameters: Value,
}

/// What a single model turn produced: done (with optional text), or tool
/// calls. Calls may end with an Assistant turn carrying the prose written
/// with them, which becomes the reply when every call is settled.
pub enum StepResult {
    Done(String),
    ToolCalls(Vec<AgentTurn>),
}

impl StepResult {
    /// A step's tool calls and the text the model wrote with them, if any.
    pub fn calls_with_text(mut calls: Vec<AgentTurn>, text: String) -> StepResult {
        if !text.trim().is_empty() {
            calls.push(AgentTurn::assistant(text));
        }
        StepResult::ToolCalls(calls)
    }
}

/// A live fragment surfaced while a provider's `agent_step` is still
/// reading its response. Purely additive: every provider still returns the
/// complete [`StepResult`] at the end.
pub enum ProviderEvent<'a> {
    /// A chunk of the assistant's prose for the in-progress turn.
    Text(&'a str),
    /// The model opened a tool call - its arguments follow as ToolArgs.
    ToolStart { call_id: &'a str, name: &'a str },
    /// A raw fragment of a tool call's JSON `arguments` string; consumers
    /// doing live display must parse it as PARTIAL json.
    ToolArgs { call_id: &'a str, delta: &'a str },
    /// The model is thinking: a fragment of its readable reasoning, or ""
    /// where the provider only says that it thinks. Never part of the answer.
    Thinking(&'a str),
    /// A page the provider's own web search cited, once per page and step in
    /// the order first cited; the final text marks it with [`citation_marker`].
    Citation { url: &'a str, title: &'a str },
}

/// What [`run_agent_loop`] reports while it runs.
pub enum LoopEvent<'a> {
    /// An intermediate turn - a ToolCall or its ToolResult - has landed.
    Turn(&'a AgentTurn),
    /// The step that just streamed came back garbled and is being asked for
    /// again: whatever it streamed is void.
    Retry,
}

/// The callback streaming-capable `agent_step`s report [`ProviderEvent`]s
/// through. A shared reference so a no-op `&|_| {}` works at call sites.
pub type EventSink<'a> = &'a (dyn Fn(ProviderEvent<'_>) + Send + Sync);

#[cfg(test)]
mod tests;
