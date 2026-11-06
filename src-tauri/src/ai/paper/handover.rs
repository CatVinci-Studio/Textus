//! How a stage hands its work over: the model works until it calls the
//! stage's one tool - submit_outline, submit_section, report_issues - whose
//! check keeps what holds and sends back what is wrong, for another try.
//! One loop for every stage, so a stage says only what it asks for and
//! what holds.

use super::model::{Model, Watch};
use aicompat::agent::{run_agent_loop, AgentTurn, ToolOutput, ToolRun, ToolSpec};
use std::sync::Mutex;

/// What a stage's check makes of a hand-over.
pub(crate) enum Checked<T> {
    /// It holds: kept, and the model is told it is done.
    Kept(T),
    /// It doesn't: what the model is told, to try again.
    Refused(String),
}

impl<T> Checked<T> {
    /// Sent back with every problem at once, for the whole `what` again.
    pub(crate) fn not_kept<S: std::borrow::Borrow<str>>(what: &str, wrong: &[S]) -> Self {
        Self::Refused(format!(
            "Not kept - fix these and send the whole {what} again:\n- {}",
            wrong.join("\n- ")
        ))
    }
}

/// A stage's task: what the model is told, the tool it hands its work over
/// with, and how many steps it has to make it hold.
pub(crate) struct Task<'a> {
    pub instructions: &'a str,
    pub message: String,
    pub tool: ToolSpec,
    pub steps: usize,
    /// Where the steps' stream goes; None steps unwatched.
    pub watch: Option<Watch<'a>>,
}

/// Runs `task` until a hand-over holds or its steps run out. Returns what
/// was kept, if anything, and the turns - for a stage that reads the
/// model's reply when nothing held.
pub(crate) async fn hand_over<T: Send>(
    model: &dyn Model,
    task: Task<'_>,
    check: impl Fn(&str) -> Checked<T> + Sync,
) -> Result<(Option<T>, Vec<AgentTurn>), String> {
    let kept = Mutex::new(None);
    let specs = [task.tool];
    let (instructions, watch) = (task.instructions, task.watch);
    let turns = run_agent_loop(
        Vec::new(),
        AgentTurn::user(task.message),
        task.steps,
        |turns: Vec<AgentTurn>| {
            let specs = &specs;
            async move {
                match watch {
                    Some(watch) => model.step_watched(instructions, &turns, specs, watch).await,
                    None => model.step(instructions, &turns, specs).await,
                }
            }
        },
        |call| {
            std::future::ready(match check(&call.arguments) {
                Checked::Kept(value) => {
                    *kept.lock().unwrap() = Some(value);
                    ToolOutput {
                        text: "Kept. Reply with one short line.".into(),
                        settled: true,
                        ..ToolOutput::default()
                    }
                }
                Checked::Refused(why) => ToolOutput::from(why),
            })
        },
        |_| ToolRun::InOrder,
        |_| {},
    )
    .await?;
    Ok((kept.into_inner().unwrap(), turns))
}

#[cfg(test)]
mod tests {
    use super::*;
    use aicompat::agent::StepResult;
    use futures_util::future::BoxFuture;

    /// Hands over the number of tool results it has seen so far, until one
    /// is kept.
    struct Counting;

    impl Model for Counting {
        fn step<'a>(
            &'a self,
            _instructions: &'a str,
            turns: &'a [AgentTurn],
            _tools: &'a [ToolSpec],
        ) -> BoxFuture<'a, Result<StepResult, String>> {
            let seen = turns
                .iter()
                .filter(|t| matches!(t, AgentTurn::ToolResult { .. }))
                .count();
            let kept = matches!(turns.last(), Some(AgentTurn::ToolResult { output, .. }) if output.starts_with("Kept."));
            Box::pin(async move {
                if kept {
                    return Ok(StepResult::Done("Done.".into()));
                }
                Ok(StepResult::ToolCalls(vec![AgentTurn::ToolCall {
                    call_id: format!("c{seen}"),
                    name: "submit".into(),
                    arguments: seen.to_string(),
                    reasoning: None,
                }]))
            })
        }
    }

    fn task(steps: usize) -> Task<'static> {
        Task {
            instructions: "Hand over a number.",
            message: "Go.".into(),
            tool: ToolSpec {
                name: "submit".into(),
                description: "".into(),
                parameters: serde_json::json!({"type": "object"}),
            },
            steps,
            watch: None,
        }
    }

    fn at_least_two(arguments: &str) -> Checked<usize> {
        match arguments.parse::<usize>() {
            Ok(n) if n >= 2 => Checked::Kept(n),
            _ => Checked::not_kept("number", &["It is less than 2."]),
        }
    }

    #[tokio::test]
    async fn a_hand_over_is_sent_back_with_why_until_one_holds() {
        let (kept, turns) = hand_over(&Counting, task(5), at_least_two).await.unwrap();
        assert_eq!(kept, Some(2));
        let sent_back: Vec<&str> = turns
            .iter()
            .filter_map(|t| match t {
                AgentTurn::ToolResult { output, .. } => Some(output.as_str()),
                _ => None,
            })
            .collect();
        assert_eq!(sent_back.len(), 3);
        assert!(sent_back[0].starts_with("Not kept - fix these and send the whole number again"));
        assert!(sent_back[0].contains("It is less than 2."));
        assert!(sent_back[2].starts_with("Kept."));
    }

    #[tokio::test]
    async fn steps_that_run_out_keep_nothing() {
        let (kept, _) = hand_over(&Counting, task(2), at_least_two).await.unwrap();
        assert_eq!(kept, None);
    }
}
