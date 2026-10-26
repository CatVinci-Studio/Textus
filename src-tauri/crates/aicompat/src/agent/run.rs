//! The agent loop: a step, its tool calls run, their results sent back,
//! until the model replies or the steps run out.

use super::*;

/// Runs the tool-calling loop shared by every agent-capable provider until
/// the model gives a final answer or `max_steps` is hit.
///
/// `on_event` gets each ToolCall and ToolResult as it lands, and a
/// [`LoopEvent::Retry`]; the final Assistant turn is not reported, as its
/// text already streamed. A step whose calls are all settled and that came
/// with text ends the exchange, the text as the reply.
///
/// A step's turns are recorded as all its calls, then all their results,
/// so a ToolCall right after a ToolResult always starts a new step; the
/// providers rely on that to group calls without rewriting cached messages.
///
/// Dropping the loop's future drops the request in flight. Results are
/// recorded in call order whatever order they finish in.
pub async fn run_agent_loop<Step, StepFut, ExecuteTool, ToolFut, Output, HowToRun, OnEvent>(
    history: Vec<AgentTurn>,
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
        // A garbled step is retried once per request: it is usually a sampling
        // accident, but text that really contains U+FFFD must not cost a retry
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
                let settled = count > 0
                    && outputs.iter().all(|output| output.settled)
                    && !(count == 1 && outputs[0].settles_with_others);
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

    // Out of steps while the model still wanted tools: without a reply the UI
    // would show the previous exchange's answer as this one's.
    new_turns.push(AgentTurn::assistant(OUT_OF_STEPS));
    Ok(new_turns)
}

/// The reply of an exchange that ran out of steps; the model reads it when
/// asked to go on. Keep in step with OUT_OF_STEPS in out-of-steps.ts.
pub const OUT_OF_STEPS: &str =
    "(Stopped at the step limit before finishing. Ask me to continue, or narrow the request.)";

pub(crate) fn call_name(call: &AgentTurn) -> &str {
    match call {
        AgentTurn::ToolCall { name, .. } => name,
        _ => "",
    }
}

/// Runs one step's calls and returns their outputs in call order: a run of
/// [`ToolRun::Concurrent`] calls together (bounded), every other call on its
/// own once the calls before it are done.
pub(crate) async fn run_calls<ExecuteTool, ToolFut, Output, HowToRun>(
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

/// Whether a step came back with U+FFFD in its text or a tool call's
/// arguments. Some servers decode byte-level tokens one at a time and send a
/// replacement character for each byte of a split character; the escaped
/// form comes from servers that JSON-encode with ASCII escapes.
pub(crate) fn garbled(result: &StepResult) -> bool {
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
/// come, when they are few, so it delivers instead of running out mid-task.
pub(crate) fn budget_note(remaining: usize) -> Option<String> {
    let steps = match remaining {
        1 => "1 step",
        2 => "2 steps",
        _ => return None,
    };
    Some(format!(
        "[Only {steps} left in this request: stop gathering or checking and deliver your result now - send any edit proposals, then give your final reply, saying what is done and what is left if you didn't get through it all.]"
    ))
}

/// A tool result with `note` after its output. Added to the step's last
/// result only when first sent, so earlier turns (and their prompt cache)
/// stay unchanged.
pub(crate) fn with_note(turn: AgentTurn, note: &str) -> AgentTurn {
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
