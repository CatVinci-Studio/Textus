//! How the paper's stages talk to a model: one step at a time, its stream
//! going to the providers' own sink, as the chat's does. A trait, so the
//! stages run on a scripted model in tests.

use super::budget::{BudgetKind, SharedBudget, STEPS_SPENT};
use aicompat::agent::{AgentTurn, StepResult, ToolSpec};
use futures_util::future::BoxFuture;

/// One step of a model: what a stage's run asks of it. A trait, so the
/// stages run on a scripted model in tests.
pub(crate) trait Model: Sync {
    fn step<'a>(
        &'a self,
        instructions: &'a str,
        turns: &'a [AgentTurn],
        tools: &'a [ToolSpec],
    ) -> BoxFuture<'a, Result<StepResult, String>>;

    /// `step`, with what it streams passed to `watch` as it comes. A model
    /// that doesn't stream just steps.
    fn step_watched<'a>(
        &'a self,
        instructions: &'a str,
        turns: &'a [AgentTurn],
        tools: &'a [ToolSpec],
        _watch: Watch<'a>,
    ) -> BoxFuture<'a, Result<StepResult, String>> {
        self.step(instructions, turns, tools)
    }
}

impl Model for aicompat::providers::AgentProvider {
    fn step<'a>(
        &'a self,
        instructions: &'a str,
        turns: &'a [AgentTurn],
        tools: &'a [ToolSpec],
    ) -> BoxFuture<'a, Result<StepResult, String>> {
        // A helper's text and thinking aren't shown: its activity is.
        self.step_watched(instructions, turns, tools, &|_| {})
    }

    fn step_watched<'a>(
        &'a self,
        instructions: &'a str,
        turns: &'a [AgentTurn],
        tools: &'a [ToolSpec],
        watch: Watch<'a>,
    ) -> BoxFuture<'a, Result<StepResult, String>> {
        Box::pin(async move {
            aicompat::providers::AgentProvider::step(self, instructions, turns, tools, watch)
                .await
                .map(|(step, _)| step)
        })
    }
}

/// A model whose every step counts against the paper's budget: with none
/// left, a step fails with STEPS_SPENT and the paper stops to ask.
pub(crate) struct Metered<'a, M: Model> {
    pub(crate) inner: &'a M,
    pub(crate) budget: &'a SharedBudget,
}

impl<M: Model> Metered<'_, M> {
    fn take(&self) -> Result<(), String> {
        if self.budget.take(BudgetKind::ModelStep) {
            Ok(())
        } else {
            Err(STEPS_SPENT.to_string())
        }
    }

    /// Whether the budget ran out on this run.
    pub(crate) fn spent(&self) -> bool {
        self.budget.snapshot().remaining().model_steps == 0
    }
}

impl<M: Model> Model for Metered<'_, M> {
    fn step<'a>(
        &'a self,
        instructions: &'a str,
        turns: &'a [AgentTurn],
        tools: &'a [ToolSpec],
    ) -> BoxFuture<'a, Result<StepResult, String>> {
        Box::pin(async move {
            self.take()?;
            self.inner.step(instructions, turns, tools).await
        })
    }

    fn step_watched<'a>(
        &'a self,
        instructions: &'a str,
        turns: &'a [AgentTurn],
        tools: &'a [ToolSpec],
        watch: Watch<'a>,
    ) -> BoxFuture<'a, Result<StepResult, String>> {
        Box::pin(async move {
            self.take()?;
            self.inner
                .step_watched(instructions, turns, tools, watch)
                .await
        })
    }
}

/// A model whose every step is told what the user asks of all the writing
/// done for them - their writing instructions, memories, style profile and
/// library (`agent::user_guidance`) - after the stage's own instructions.
pub(crate) struct Guided<'a, M: Model> {
    pub(crate) inner: &'a M,
    pub(crate) guidance: &'a str,
}

impl<M: Model> Guided<'_, M> {
    fn instructions(&self, instructions: &str) -> String {
        if self.guidance.is_empty() {
            instructions.to_string()
        } else {
            format!("{instructions}\n\n{}", self.guidance)
        }
    }
}

impl<M: Model> Model for Guided<'_, M> {
    fn step<'a>(
        &'a self,
        instructions: &'a str,
        turns: &'a [AgentTurn],
        tools: &'a [ToolSpec],
    ) -> BoxFuture<'a, Result<StepResult, String>> {
        Box::pin(async move {
            let instructions = self.instructions(instructions);
            self.inner.step(&instructions, turns, tools).await
        })
    }

    fn step_watched<'a>(
        &'a self,
        instructions: &'a str,
        turns: &'a [AgentTurn],
        tools: &'a [ToolSpec],
        watch: Watch<'a>,
    ) -> BoxFuture<'a, Result<StepResult, String>> {
        Box::pin(async move {
            let instructions = self.instructions(instructions);
            self.inner
                .step_watched(&instructions, turns, tools, watch)
                .await
        })
    }
}

/// Where a step's stream goes, as it comes: the providers' own sink, so a
/// stage sees what the chat sees.
pub(crate) type Watch<'a> = aicompat::agent::EventSink<'a>;

/// The longest an activity's detail is sent: the card shows one line.
const DETAIL_CHARS: usize = 120;

pub(crate) fn clip(text: &str) -> String {
    let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.chars().count() <= DETAIL_CHARS {
        return text;
    }
    let cut: String = text.chars().take(DETAIL_CHARS - 1).collect();
    format!("{cut}…")
}

/// One tool-less step, as it streams to `watch`: the model's reply to
/// `message`, or "" when it calls a tool anyway.
pub(crate) async fn ask(
    model: &dyn Model,
    instructions: &str,
    message: String,
    watch: Watch<'_>,
) -> Result<String, String> {
    let turns = [AgentTurn::user(message)];
    Ok(
        match model.step_watched(instructions, &turns, &[], watch).await? {
            StepResult::Done(text) => text,
            StepResult::ToolCalls(_) => String::new(),
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::workspace::AgentWorkspace;

    /// Answers each step with the instructions it was given.
    struct Echo;

    impl Model for Echo {
        fn step<'a>(
            &'a self,
            instructions: &'a str,
            _turns: &'a [AgentTurn],
            _tools: &'a [ToolSpec],
        ) -> BoxFuture<'a, Result<StepResult, String>> {
            Box::pin(async move { Ok(StepResult::Done(instructions.to_string())) })
        }
    }

    #[tokio::test]
    async fn research_writes_as_the_user_asks_of_their_writing() {
        let mut workspace = AgentWorkspace {
            instructions: vec!["Never use emoji.".into()],
            project_instructions: Some("Say \"customers\", not \"users\".".into()),
            style: Some("Short sentences.".into()),
            ..Default::default()
        };
        let guidance = crate::ai::agent::writing_guidance(&mut workspace, "Tides");
        let guided = Guided {
            inner: &Echo,
            guidance: &guidance,
        };
        let StepResult::Done(sent) = guided.step("Write the section.", &[], &[]).await.unwrap()
        else {
            panic!("a tool call");
        };
        assert!(sent.starts_with("Write the section."), "{sent}");
        for asked in ["Never use emoji.", "not \"users\"", "Short sentences."] {
            assert!(sent.contains(asked), "{sent}");
        }
    }
}
