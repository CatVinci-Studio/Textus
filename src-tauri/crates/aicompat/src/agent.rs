use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::borrow::Cow;

/// An image riding along with a user turn.
///
/// Images are the one attachment kind with no text to extract, so they can't
/// be inlined into the prompt the way a PDF or spreadsheet is (see the main
/// crate's commands/attachment.rs). They have to reach the model as the
/// provider's own image content part, which is what every `turns_to_*`
/// function below builds. `data_base64` is the raw file, base64-encoded;
/// `mime` is what the provider is told it is.
#[derive(Serialize, Deserialize, Clone, Debug)]
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
/// Mirrored by `AgentTurn` in src/ai/types.ts.
#[derive(Serialize, Deserialize, Clone, Debug)]
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

/// One web page a reply cites as `[n]`. Mirrored by `WebSource` in
/// src/ai/types.ts.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
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

const MARKER_OPEN: char = '\u{E000}';
const MARKER_CLOSE: char = '\u{E001}';

/// Where a step's text cites the `k`th (1-based) [`ProviderEvent::Citation`]
/// it reported: the number between two private-use characters, which no
/// model writes, so the caller can swap each for the `[n]` it gives that
/// page across the conversation (see [`replace_citation_markers`]).
pub fn citation_marker(k: usize) -> String {
    format!("{MARKER_OPEN}{k}{MARKER_CLOSE}")
}

/// `text` with each [`citation_marker`] replaced by what `number` makes of
/// its index, or removed when it returns None.
pub fn replace_citation_markers(text: &str, number: impl Fn(usize) -> Option<String>) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find(MARKER_OPEN) {
        out.push_str(&rest[..start]);
        let after = &rest[start + MARKER_OPEN.len_utf8()..];
        let Some(end) = after.find(MARKER_CLOSE) else {
            rest = after;
            continue;
        };
        if let Some(n) = after[..end].parse().ok().and_then(&number) {
            out.push_str(&n);
        }
        rest = &after[end + MARKER_CLOSE.len_utf8()..];
    }
    out.push_str(rest);
    out
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

/// One step's citations as a provider reads them: each page once, in the
/// order first cited, reported through the sink as it is found.
#[derive(Default)]
pub struct StepCitations {
    urls: Vec<String>,
}

impl StepCitations {
    /// The marker for `url`, reporting the page first if this step hasn't.
    pub fn cite(&mut self, url: &str, title: &str, on_event: EventSink<'_>) -> String {
        let k = match self.urls.iter().position(|u| u == url) {
            Some(i) => i + 1,
            None => {
                self.urls.push(url.to_string());
                on_event(ProviderEvent::Citation { url, title });
                self.urls.len()
            }
        };
        citation_marker(k)
    }
}

/// A span of a reply's text that cites a page: character (not byte)
/// offsets, end exclusive, as OpenAI-style `url_citation` annotations give
/// them.
pub struct CitedSpan<'a> {
    pub start: usize,
    pub end: usize,
    pub url: &'a str,
    pub title: &'a str,
}

/// `text` with each cited span marked. Where a span is the inline link the
/// provider wrote for its citation - OpenAI's "([site](url))", xAI's
/// "[[1]](url)", OpenRouter's "[site](url)" - the link gives way to the
/// marker; a span of plain prose keeps its words and gets the marker after
/// them. A span that doesn't fit the text (a server counting otherwise)
/// still has its page cited, at the end.
pub fn mark_cited_spans(
    text: &str,
    mut spans: Vec<CitedSpan<'_>>,
    citations: &mut StepCitations,
    on_event: EventSink<'_>,
) -> String {
    let chars: Vec<char> = text.chars().collect();
    spans.sort_by_key(|s| (s.start, s.end));
    let mut out = String::with_capacity(text.len());
    let mut at = 0;
    let mut trailing = String::new();
    for span in spans {
        let marker = citations.cite(span.url, span.title, on_event);
        if span.start < at || span.end > chars.len() || span.start > span.end {
            if !out.contains(&marker) && !trailing.contains(&marker) {
                trailing.push_str(&marker);
            }
            continue;
        }
        out.extend(&chars[at..span.start]);
        let cited: String = chars[span.start..span.end].iter().collect();
        if cited.contains("](") || cited.contains("http") {
            // "fact ([site](url))." reads "fact [1]." - the parentheses
            // around the link go with it, whether or not the span has them.
            let wrapped = out.ends_with('(') && chars.get(span.end) == Some(&')');
            if wrapped {
                out.pop();
            }
            out.push_str(&marker);
            at = span.end + usize::from(wrapped);
        } else {
            out.push_str(&cited);
            out.push_str(&marker);
            at = span.end;
        }
    }
    out.extend(&chars[at.min(chars.len())..]);
    out.push_str(&trailing);
    out
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

/// Runs the tool-calling round-trip loop shared by every agent-capable
/// provider: feed the model the turn history, and if it asks to call tools,
/// run them and feed the results back, until it produces a final answer or
/// `max_steps` is hit.
///
/// This knows nothing about any specific provider's wire format (that's
/// `step`'s job) or what tools actually do (that's `execute_tool`'s job) - it
/// only owns turn bookkeeping. That separation is what lets a new provider or
/// a new tool source (e.g. an MCP server down the line) plug in without
/// touching this loop: a provider implements `step`, a tool source
/// contributes entries that `execute_tool` can dispatch to.
///
/// `on_event` gets every intermediate turn as it lands (each ToolCall and
/// its ToolResult) - the loop-level counterpart of [`ProviderEvent`],
/// letting a UI show tool activity live - and a [`LoopEvent::Retry`] when a
/// step is sent again. The final Assistant turn is NOT reported: its text
/// already streamed out as ProviderEvent::Text, and the returned turn list
/// is the authoritative ending either way.
///
/// A step whose calls are all settled ([`ToolOutput::settled`]) and that
/// came with text ends the exchange, the text as the reply: asking again
/// only for the closing sentence was one request of every two or three an
/// edit took.
///
/// Near the end of `max_steps` the model is told how many steps it has
/// left, in what it is shown but not in what is recorded (`budget_note`).
///
/// A step's turns are recorded as all of its calls, then all of their
/// results (Call1, Call2, Result1, Result2), so a ToolCall right after a
/// ToolResult always starts a new step. The providers group a step's calls
/// into one assistant message by that rule; with the calls and results
/// interleaved they couldn't tell parallel calls from sequential steps, and
/// merging every step into one message rewrote the earlier steps' messages
/// - and their prompt cache - on each new step.
///
/// `execute_tool` is async, so a tool waiting on the network (a web search,
/// a picture being made) holds no thread, and dropping the loop's future -
/// the chat's Stop (ai::cancel in the main crate) - drops the request in
/// flight with it. `tool_run` says how each tool's calls are run
/// ([`ToolRun`]); results are recorded in call order whatever order they
/// finish in.
pub async fn run_agent_loop<Step, StepFut, ExecuteTool, ToolFut, Output, HowToRun, OnEvent>(
    history: Vec<AgentTurn>,
    // `user_turn` is a whole AgentTurn rather than the bare message string it
    // used to be, because the turn the user just sent may carry images
    // alongside its text.
    user_turn: AgentTurn,
    max_steps: usize,
    mut step: Step,
    execute_tool: ExecuteTool,
    tool_run: HowToRun,
    mut on_event: OnEvent,
) -> Result<Vec<AgentTurn>, String>
where
    Step: FnMut(Vec<AgentTurn>) -> StepFut,
    StepFut: std::future::Future<Output = Result<StepResult, String>>,
    ExecuteTool: Fn(ToolCall) -> ToolFut,
    ToolFut: std::future::Future<Output = Output>,
    Output: Into<ToolOutput>,
    HowToRun: Fn(&str) -> ToolRun,
    OnEvent: FnMut(LoopEvent<'_>),
{
    let mut turns = history;
    turns.push(user_turn.clone());
    let mut new_turns = vec![user_turn];
    let mut retried = false;

    for step_index in 0..max_steps {
        let mut result = step(turns.clone()).await?;
        // A garbled step is asked for again, once per request: the broken
        // characters are a sampling accident that a second try almost
        // always gets through whole, while text that really contains
        // U+FFFD (quoted from a damaged document) must not cost a retry
        // on every step.
        if !retried && garbled(&result) {
            retried = true;
            on_event(LoopEvent::Retry);
            result = step(turns.clone()).await?;
        }
        match result {
            StepResult::Done(text) => {
                let turn = AgentTurn::assistant(text);
                turns.push(turn.clone());
                new_turns.push(turn);
                return Ok(new_turns);
            }
            StepResult::ToolCalls(calls) => {
                let reply = calls.iter().find_map(|turn| match turn {
                    AgentTurn::Assistant { text, .. } if !text.trim().is_empty() => {
                        Some(text.clone())
                    }
                    _ => None,
                });
                let mut calls: Vec<AgentTurn> = calls
                    .into_iter()
                    .filter(|call| matches!(call, AgentTurn::ToolCall { .. }))
                    .collect();
                let amends = calls
                    .iter()
                    .any(|call| tool_run(call_name(call)) == ToolRun::Amending);
                if !amends {
                    for call in &calls {
                        on_event(LoopEvent::Turn(call));
                    }
                }
                let outputs = run_calls(&calls, &execute_tool, &tool_run).await;
                for (call, output) in calls.iter_mut().zip(&outputs) {
                    if let (AgentTurn::ToolCall { arguments, .. }, Some(amended)) =
                        (call, &output.call_arguments)
                    {
                        arguments.clone_from(amended);
                    }
                }
                for call in &calls {
                    if amends {
                        on_event(LoopEvent::Turn(call));
                    }
                    turns.push(call.clone());
                    new_turns.push(call.clone());
                }
                let remaining = max_steps - step_index - 1;
                let count = calls.len();
                let settled = count > 0 && outputs.iter().all(|output| output.settled);
                for (index, (call, output)) in calls.iter().zip(outputs).enumerate() {
                    let AgentTurn::ToolCall { call_id, .. } = call else {
                        continue;
                    };
                    let result_turn = AgentTurn::ToolResult {
                        call_id: call_id.clone(),
                        output: output.text,
                        images: output.images,
                    };
                    on_event(LoopEvent::Turn(&result_turn));
                    new_turns.push(result_turn.clone());
                    turns.push(match budget_note(remaining) {
                        Some(note) if index + 1 == count => with_note(result_turn, &note),
                        _ => result_turn,
                    });
                }
                if let Some(reply) = reply.filter(|_| settled) {
                    new_turns.push(AgentTurn::assistant(reply));
                    return Ok(new_turns);
                }
            }
        }
    }

    // Out of steps while the model still wanted tools. Ending on a bare
    // ToolResult left the exchange with no reply at all - the UI then showed
    // the PREVIOUS exchange's answer as this one's - so say what happened.
    new_turns.push(AgentTurn::assistant(format!(
        "(Stopped after {max_steps} tool steps without finishing. Ask me to continue, or narrow the request.)"
    )));
    Ok(new_turns)
}

fn call_name(call: &AgentTurn) -> &str {
    match call {
        AgentTurn::ToolCall { name, .. } => name,
        _ => "",
    }
}

/// Runs one step's calls and returns their outputs in call order: a run of
/// [`ToolRun::Concurrent`] calls together (bounded), every other call on its
/// own once the calls before it are done - a proposal still lands after
/// the reads the model sent before it.
async fn run_calls<ExecuteTool, ToolFut, Output, HowToRun>(
    calls: &[AgentTurn],
    execute_tool: &ExecuteTool,
    tool_run: &HowToRun,
) -> Vec<ToolOutput>
where
    ExecuteTool: Fn(ToolCall) -> ToolFut,
    ToolFut: std::future::Future<Output = Output>,
    Output: Into<ToolOutput>,
    HowToRun: Fn(&str) -> ToolRun,
{
    use futures_util::stream::{self, StreamExt};
    let run = |call: &AgentTurn| {
        let call = match call {
            AgentTurn::ToolCall {
                call_id,
                name,
                arguments,
                ..
            } => ToolCall {
                call_id: call_id.clone(),
                name: name.clone(),
                arguments: arguments.clone(),
            },
            _ => ToolCall::default(),
        };
        let fut = execute_tool(call);
        async move { fut.await.into() }
    };
    let mut outputs = Vec::with_capacity(calls.len());
    let mut rest = calls;
    while let Some(first) = rest.first() {
        if tool_run(call_name(first)) != ToolRun::Concurrent {
            outputs.push(run(first).await);
            rest = &rest[1..];
            continue;
        }
        let batch = rest
            .iter()
            .take_while(|call| tool_run(call_name(call)) == ToolRun::Concurrent)
            .count();
        let done: Vec<ToolOutput> = stream::iter(&rest[..batch])
            .map(run)
            .buffered(MAX_CONCURRENT_TOOLS)
            .collect()
            .await;
        outputs.extend(done);
        rest = &rest[batch..];
    }
    outputs
}

/// Whether a step came back with U+FFFD in its text or in a tool call's
/// arguments. Some servers decode a model's byte-level tokens one at a
/// time and send a replacement character for each byte of a character
/// split across tokens - 《百年孤独》 arrived as 《百年孤���》 - and by then
/// the text is lost: shown, or applied as an edit, it would put the broken
/// characters in front of the user. The escaped form is what a server that
/// JSON-encodes with ASCII escapes sends inside tool arguments.
fn garbled(result: &StepResult) -> bool {
    let broken = |s: &str| s.contains('\u{FFFD}') || s.contains("\\ufffd") || s.contains("\\uFFFD");
    match result {
        StepResult::Done(text) => broken(text),
        StepResult::ToolCalls(calls) => calls.iter().any(|call| match call {
            AgentTurn::ToolCall { arguments, .. } => broken(arguments),
            AgentTurn::Assistant { text, .. } => broken(text),
            _ => false,
        }),
    }
}

/// What the model is told after a step with `remaining` steps still to
/// come, when they are few. One that kept checking its work used to run
/// out of steps mid-task and leave the user with nothing.
fn budget_note(remaining: usize) -> Option<String> {
    let steps = match remaining {
        1 => "1 step",
        2 => "2 steps",
        _ => return None,
    };
    Some(format!(
        "[Only {steps} left in this request: stop gathering or checking and deliver your result now - send any edit proposals, then give your final reply.]"
    ))
}

/// A tool result with `note` after its output. Added to the step's last
/// result once, when it is first sent, so the turns before it stay as they
/// were from step to step (and their prompt cache valid).
fn with_note(turn: AgentTurn, note: &str) -> AgentTurn {
    match turn {
        AgentTurn::ToolResult {
            call_id,
            output,
            images,
        } => AgentTurn::ToolResult {
            call_id,
            output: format!("{output}\n\n{note}"),
            images,
        },
        other => other,
    }
}

#[cfg(test)]
mod tests;
