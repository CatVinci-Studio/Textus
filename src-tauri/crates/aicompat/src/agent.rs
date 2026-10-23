use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::borrow::Cow;

mod citations;
pub use citations::*;
mod run;
pub use run::*;

/// An image riding along with a user turn.
///
/// Images are the one attachment kind with no text to extract, so they can't
/// be inlined into the prompt the way a PDF or spreadsheet is (see the main
/// crate's commands/attachment.rs). They have to reach the model as the
/// provider's own image content part, which is what every `turns_to_*`
/// function below builds. `data_base64` is the raw file, base64-encoded;
/// `mime` is what the provider is told it is. Generated into the app's
/// src/platform/bindings/ai-agent.ts.
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

/// One entry in an agent conversation. Kept provider-agnostic so the main
/// crate's loop doesn't need to know about each provider's wire format.
/// Generated into the app's src/platform/bindings/ai-agent.ts; `AgentTurn` in
/// src/ai/types.ts is the narrower turn the frontend keeps.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(tag = "kind")]
pub enum AgentTurn {
    User {
        text: String,
        /// Defaulted, because conversations saved before images existed are
        /// still in users' localStorage (see chat-history.ts) and must keep
        /// deserializing.
        #[serde(default)]
        images: Vec<ImageAttachment>,
    },
    Assistant {
        text: String,
        /// The web pages the reply cites as [n] - Textus's own web_search
        /// and web_fetch results and the provider's native search
        /// citations, numbered once per conversation. Defaulted and skipped
        /// when empty, so conversations saved before web sources keep
        /// deserializing and a reply without any stays `{kind, text}`.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        sources: Vec<Source>,
    },
    ToolCall {
        call_id: String,
        name: String,
        arguments: String,
        /// The model's reasoning for the step this call opens, in its
        /// provider's own wire shape (Claude's thinking blocks, an
        /// OpenAI-compatible `reasoning_content` string) - on the first call
        /// of a step only. Sent back with the step's calls for the rest of
        /// the exchange, where thinking with tools requires it; the main
        /// crate drops it before the turn reaches the frontend, so it never
        /// outlives the exchange (or appears in `AgentTurn` in types.ts).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        reasoning: Option<Value>,
    },
    ToolResult {
        call_id: String,
        output: String,
        /// Images the tool showed the model (Textus AI's view_image). Each
        /// dialect delivers them its own way - inside the tool result where
        /// the API takes images there, as a user message right after it
        /// where it doesn't. They are for the request in flight only: the
        /// main crate drops them before the turn reaches the frontend's
        /// history, as the frontend drops a user turn's images.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        images: Vec<ImageAttachment>,
    },
}

/// One web page a reply cites as `[n]`. Generated into the app's
/// src/platform/bindings/ai-agent.ts as WebSource, its name there (JSON never
/// carries a struct's name).
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
    /// [`ToolRun::Amending`] tool: generate_image's call carries the picture
    /// it made, which is what the frontend shows the proposal from.
    pub call_arguments: Option<String>,
    /// The call did what it was for and needs nothing more from the model:
    /// a valid proposal or comment, now the user's to decide. When every
    /// call of a step is settled and the model wrote its reply with them,
    /// the loop ends there instead of asking for the reply again.
    pub settled: bool,
    /// Settled only beside other calls: a step of this call alone goes on
    /// to one more step. A review's comments come several to a step; one
    /// pinned alone was a model that meant to go on, and the request ended
    /// with the rest only promised in its reply.
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

/// Token accounting for one agent step, the same for every dialect: input
/// not read from the cache, input written to it (Claude only - the others
/// cache by themselves), input read from it, and output. Claude reports it
/// in its stream's message_start / message_delta events, the OpenAI-style
/// APIs in `usage` ([`StepUsage::from_openai`]).
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

    /// An OpenAI-style `usage` object: Chat Completions' `prompt_tokens`
    /// and `completion_tokens`, or the Responses API's `input_tokens` and
    /// `output_tokens`. Both count cached input inside the input total; the
    /// cached part is `*_tokens_details.cached_tokens` (OpenAI, Gemini, Qwen,
    /// Doubao), `prompt_cache_hit_tokens` (DeepSeek) or `cached_tokens`
    /// (Kimi). None when there is no usage to read.
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
    /// [`MAX_CONCURRENT_TOOLS`], so one waiting on the network doesn't hold
    /// up the rest.
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
/// dialect can't put them in the tool result itself - so the model reads
/// them as the tool's answer, not as something the user sent.
pub fn tool_images_note(images: &[ImageAttachment]) -> String {
    let names: Vec<&str> = images.iter().map(|i| i.name.as_str()).collect();
    format!(
        "(Opened by the tool call above, not sent by the user: {})",
        names.join(", ")
    )
}

/// A tool the model may call. `parameters` is a JSON schema object. Name
/// and description are owned or borrowed: the built-in tools' are
/// constants, a plugin's or an MCP server's arrive at run time.
#[derive(Clone, Debug)]
pub struct ToolSpec {
    pub name: Cow<'static, str>,
    pub description: Cow<'static, str>,
    pub parameters: Value,
}

/// What a single model turn produced: either it's done talking (with
/// optional text), or it wants to call one or more tools before continuing.
/// A step's calls may end with an Assistant turn: the prose the model wrote
/// with them ([`StepResult::calls_with_text`]), which becomes the reply when
/// every call is settled ([`ToolOutput::settled`]).
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
/// reading its response - assistant prose as it's generated, and tool
/// calls as their JSON arguments accumulate. Purely additive: every
/// provider still returns the same complete [`StepResult`] at the end,
/// so a caller that ignores these events loses nothing but liveness.
///
/// Borrowed strs on purpose: events fire from inside SSE read loops, and
/// most sinks only forward them (serializing to owned data anyway).
pub enum ProviderEvent<'a> {
    /// A chunk of the assistant's prose for the in-progress turn.
    Text(&'a str),
    /// The model opened a tool call - its arguments follow as ToolArgs.
    ToolStart { call_id: &'a str, name: &'a str },
    /// A raw fragment of a tool call's JSON `arguments` string. Fragments
    /// concatenate to the same string the final ToolCall turn carries;
    /// consumers doing live display must parse it as PARTIAL json.
    ToolArgs { call_id: &'a str, delta: &'a str },
    /// The model is thinking: a fragment of its readable reasoning, or ""
    /// where the provider only says that it thinks (Claude's default
    /// display, an OpenAI reasoning item without a summary). Never part of
    /// the step's answer.
    Thinking(&'a str),
    /// A page the provider's own web search cited. Reported once per page
    /// and step, in the order first cited: the step's final text marks each
    /// place it is cited with [`citation_marker`] of its place in that order.
    Citation { url: &'a str, title: &'a str },
}

/// What [`run_agent_loop`] reports while it runs.
pub enum LoopEvent<'a> {
    /// An intermediate turn - a ToolCall or its ToolResult - has landed.
    Turn(&'a AgentTurn),
    /// The step that just streamed came back garbled (see `garbled`) and
    /// is being asked for again: whatever it streamed is void.
    Retry,
}

/// The callback streaming-capable `agent_step`s report [`ProviderEvent`]s
/// through. A shared reference (not a generic) so provider signatures stay
/// object-simple and a no-op `&|_| {}` works at call sites without events.
pub type EventSink<'a> = &'a (dyn Fn(ProviderEvent<'_>) + Send + Sync);

#[cfg(test)]
mod tests;
