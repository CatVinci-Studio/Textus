use serde::{Deserialize, Serialize};
use serde_json::Value;

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
    },
    ToolCall {
        call_id: String,
        name: String,
        arguments: String,
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

/// What a tool returns to the loop: text, and any images it shows the
/// model. A plain `String` converts, so tools without images return text.
#[derive(Clone, Debug, Default)]
pub struct ToolOutput {
    pub text: String,
    pub images: Vec<ImageAttachment>,
}

impl From<String> for ToolOutput {
    fn from(text: String) -> Self {
        Self {
            text,
            images: Vec::new(),
        }
    }
}

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

/// A tool the model may call. `parameters` is a JSON schema object.
#[derive(Clone)]
pub struct ToolSpec {
    pub name: &'static str,
    pub description: &'static str,
    pub parameters: Value,
}

/// What a single model turn produced: either it's done talking (with
/// optional text), or it wants to call one or more tools before continuing.
pub enum StepResult {
    Done(String),
    ToolCalls(Vec<AgentTurn>),
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
pub async fn run_agent_loop<Step, StepFut, ExecuteTool, Output, OnEvent>(
    history: Vec<AgentTurn>,
    // `user_turn` is a whole AgentTurn rather than the bare message string it
    // used to be, because the turn the user just sent may carry images
    // alongside its text.
    user_turn: AgentTurn,
    max_steps: usize,
    mut step: Step,
    mut execute_tool: ExecuteTool,
    mut on_event: OnEvent,
) -> Result<Vec<AgentTurn>, String>
where
    Step: FnMut(Vec<AgentTurn>) -> StepFut,
    StepFut: std::future::Future<Output = Result<StepResult, String>>,
    ExecuteTool: FnMut(&str, &str) -> Output,
    Output: Into<ToolOutput>,
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
                let turn = AgentTurn::Assistant { text };
                turns.push(turn.clone());
                new_turns.push(turn);
                return Ok(new_turns);
            }
            StepResult::ToolCalls(calls) => {
                let calls: Vec<AgentTurn> = calls
                    .into_iter()
                    .filter(|call| matches!(call, AgentTurn::ToolCall { .. }))
                    .collect();
                for call in &calls {
                    on_event(LoopEvent::Turn(call));
                    turns.push(call.clone());
                    new_turns.push(call.clone());
                }
                let remaining = max_steps - step_index - 1;
                for (index, call) in calls.iter().enumerate() {
                    let AgentTurn::ToolCall {
                        call_id,
                        name,
                        arguments,
                    } = call
                    else {
                        continue;
                    };
                    let ToolOutput { text, images } = execute_tool(name, arguments).into();
                    let result_turn = AgentTurn::ToolResult {
                        call_id: call_id.clone(),
                        output: text,
                        images,
                    };
                    on_event(LoopEvent::Turn(&result_turn));
                    new_turns.push(result_turn.clone());
                    turns.push(match budget_note(remaining) {
                        Some(note) if index + 1 == calls.len() => with_note(result_turn, &note),
                        _ => result_turn,
                    });
                }
            }
        }
    }

    // Out of steps while the model still wanted tools. Ending on a bare
    // ToolResult left the exchange with no reply at all - the UI then showed
    // the PREVIOUS exchange's answer as this one's - so say what happened.
    new_turns.push(AgentTurn::Assistant {
        text: format!(
            "(Stopped after {max_steps} tool steps without finishing. Ask me to continue, or narrow the request.)"
        ),
    });
    Ok(new_turns)
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
        StepResult::ToolCalls(calls) => calls
            .iter()
            .any(|call| matches!(call, AgentTurn::ToolCall { arguments, .. } if broken(arguments))),
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
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::collections::VecDeque;

    fn call(id: &str, name: &str, arguments: &str) -> AgentTurn {
        AgentTurn::ToolCall {
            call_id: id.into(),
            name: name.into(),
            arguments: arguments.into(),
        }
    }

    fn user(text: &str) -> AgentTurn {
        AgentTurn::User {
            text: text.into(),
            images: Vec::new(),
        }
    }

    /// Drives the loop with a scripted "model": each step pops the next
    /// response, and records the history it was shown.
    fn run_scripted<R: Into<ToolOutput>>(
        script: Vec<StepResult>,
        max_steps: usize,
        execute: impl FnMut(&str, &str) -> R,
    ) -> (Vec<AgentTurn>, Vec<Vec<AgentTurn>>) {
        let script = RefCell::new(VecDeque::from(script));
        let seen = RefCell::new(Vec::new());
        let turns = tauri::async_runtime::block_on(run_agent_loop(
            vec![],
            user("go"),
            max_steps,
            |history| {
                seen.borrow_mut().push(history);
                let next = script.borrow_mut().pop_front();
                async move { next.ok_or_else(|| "script ran out".to_string()) }
            },
            execute,
            |_| {},
        ))
        .unwrap();
        (turns, seen.into_inner())
    }

    #[test]
    fn tool_results_are_fed_back_before_the_final_answer() {
        let (turns, seen) = run_scripted(
            vec![
                StepResult::ToolCalls(vec![call("1", "search_document", r#"{"query":"x"}"#)]),
                StepResult::Done("found it".into()),
            ],
            12,
            |name, _| format!("ran {name}"),
        );
        assert_eq!(turns.len(), 4); // user, call, result, answer
        assert!(
            matches!(&turns[2], AgentTurn::ToolResult { output, .. } if output == "ran search_document")
        );
        assert!(matches!(&turns[3], AgentTurn::Assistant { text } if text == "found it"));
        // The second step saw the call and its result.
        assert_eq!(seen[1].len(), 3);
    }

    /// A step's calls come first, then their results in the same order, so
    /// a call after a result marks the next step - what the providers group
    /// assistant messages by.
    #[test]
    fn each_step_records_its_calls_then_their_results() {
        let (turns, seen) = run_scripted(
            vec![
                StepResult::ToolCalls(vec![call("a", "t1", "{}"), call("b", "t2", "{}")]),
                StepResult::ToolCalls(vec![call("c", "t3", "{}")]),
                StepResult::Done(String::new()),
            ],
            12,
            |name, _| name.to_string(),
        );
        let ids: Vec<_> = turns
            .iter()
            .filter_map(|t| match t {
                AgentTurn::ToolCall { call_id, .. } => Some(format!("call:{call_id}")),
                AgentTurn::ToolResult { call_id, .. } => Some(format!("result:{call_id}")),
                _ => None,
            })
            .collect();
        assert_eq!(
            ids,
            ["call:a", "call:b", "result:a", "result:b", "call:c", "result:c"]
        );
        // Each step is shown the one before it plus what it added - the
        // earlier turns never change, which is what keeps the prefix cached.
        assert_eq!(seen[2].len(), seen[1].len() + 2);
        assert_eq!(
            format!("{:?}", &seen[2][..seen[1].len()]),
            format!("{:?}", seen[1])
        );
    }

    #[test]
    fn a_tools_images_land_in_its_result_turn() {
        let (turns, _) = run_scripted(
            vec![
                StepResult::ToolCalls(vec![call("v", "view_image", "{}")]),
                StepResult::Done(String::new()),
            ],
            12,
            |_, _| ToolOutput {
                text: "Here is map.png.".into(),
                images: vec![ImageAttachment {
                    name: "map.png".into(),
                    mime: "image/png".into(),
                    data_base64: "AAAA".into(),
                }],
            },
        );
        let AgentTurn::ToolResult { output, images, .. } = &turns[2] else {
            panic!("the call's result follows it");
        };
        assert_eq!(output, "Here is map.png.");
        assert_eq!(images[0].name, "map.png");
    }

    #[test]
    fn running_out_of_steps_still_ends_with_a_reply() {
        let looping = (0..3)
            .map(|i| StepResult::ToolCalls(vec![call(&i.to_string(), "search_document", "{}")]))
            .collect();
        let (turns, _) = run_scripted(looping, 3, |_, _| "nothing".to_string());
        let AgentTurn::Assistant { text } = turns.last().unwrap() else {
            panic!("the exchange must end with an assistant turn");
        };
        assert!(text.contains("Stopped after 3 tool steps"));
    }

    #[test]
    fn the_last_steps_are_announced_to_the_model_only() {
        let looping = (0..4)
            .map(|i| StepResult::ToolCalls(vec![call(&i.to_string(), "measure_text", "{}")]))
            .collect();
        let (turns, seen) = run_scripted(looping, 4, |_, _| "12 chars".to_string());
        let noted = |history: &[AgentTurn]| {
            history.iter().any(|t| {
                matches!(t, AgentTurn::ToolResult { output, .. } if output.contains("left in this request"))
            })
        };
        // The second step is told nothing; the third sees the two steps
        // still to come, the last that it is the last.
        assert!(!noted(&seen[1]));
        assert!(matches!(
            seen[2].last(),
            Some(AgentTurn::ToolResult { output, .. })
                if output.starts_with("12 chars") && output.contains("Only 2 steps left")
        ));
        assert!(matches!(
            seen[3].last(),
            Some(AgentTurn::ToolResult { output, .. }) if output.contains("Only 1 step left")
        ));
        // Earlier turns are shown as they were first sent.
        assert_eq!(
            format!("{:?}", &seen[3][..seen[2].len()]),
            format!("{:?}", seen[2])
        );
        // What is recorded (and shown to the user) carries no note.
        assert!(!noted(&turns));
    }

    /// Runs the loop on `script`, returning the turns and how many times
    /// it reported a retry.
    fn run_counting_retries(script: Vec<StepResult>) -> (Vec<AgentTurn>, usize) {
        let script = RefCell::new(VecDeque::from(script));
        let retries = RefCell::new(0);
        let turns = tauri::async_runtime::block_on(run_agent_loop(
            vec![],
            user("go"),
            12,
            |_| {
                let next = script.borrow_mut().pop_front();
                async move { next.ok_or_else(|| "script ran out".to_string()) }
            },
            |name, _| name.to_string(),
            |event| {
                if let LoopEvent::Retry = event {
                    *retries.borrow_mut() += 1;
                }
            },
        ))
        .unwrap();
        (turns, retries.into_inner())
    }

    #[test]
    fn a_garbled_step_is_asked_for_again_once() {
        let edit = |text: &str| {
            StepResult::ToolCalls(vec![call(
                "e",
                "propose_edit",
                &format!(r#"{{"action":"append","text":"{text}"}}"#),
            )])
        };
        let (turns, retries) = run_counting_retries(vec![
            edit("《百年孤\u{FFFD}\u{FFFD}\u{FFFD}》"),
            edit("《百年孤独》"),
            StepResult::Done("《百年孤\u{FFFD}》".into()),
        ]);
        assert_eq!(retries, 1);
        // The garbled call never ran; the one sent again did.
        let AgentTurn::ToolCall { arguments, .. } = &turns[1] else {
            panic!("the call follows the user turn");
        };
        assert!(arguments.contains("《百年孤独》"));
        // Once per request: a later garbled reply stands.
        assert!(
            matches!(turns.last(), Some(AgentTurn::Assistant { text }) if text.contains('\u{FFFD}'))
        );
    }

    #[test]
    fn a_garbled_reply_is_asked_for_again() {
        let (turns, retries) = run_counting_retries(vec![
            StepResult::Done("《百年孤\u{FFFD}》".into()),
            StepResult::Done("《百年孤独》".into()),
        ]);
        assert_eq!(retries, 1);
        assert!(matches!(&turns[1], AgentTurn::Assistant { text } if text == "《百年孤独》"));
        // An escaped replacement character in tool arguments counts too.
        let escaped =
            StepResult::ToolCalls(vec![call("e", "propose_edit", r#"{"text":"\ufffd"}"#)]);
        assert!(garbled(&escaped));
        assert!(!garbled(&StepResult::Done("《百年孤独》".into())));
    }

    #[test]
    fn a_step_error_aborts_the_exchange() {
        let result = tauri::async_runtime::block_on(run_agent_loop(
            vec![],
            user("go"),
            12,
            |_| async { Err::<StepResult, _>("429 rate limited".to_string()) },
            |_, _| String::new(),
            |_| {},
        ));
        assert_eq!(result.unwrap_err(), "429 rate limited");
    }
}
