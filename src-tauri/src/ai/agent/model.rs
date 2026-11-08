//! How every request talks to a model: one step at a time, its stream
//! going to the providers' own sink. The chat's loop, its chapter helpers
//! and Research's stages all step through this trait, so each runs on a
//! scripted model in tests.

use aicompat::agent::{AgentTurn, StepResult, ToolSpec};
use futures_util::future::BoxFuture;

/// One step of a model: what a request's run asks of it. A trait, so the
/// runs go on a scripted model in tests.
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

    /// How many steps it takes at once: what a stage starts together. A
    /// model that doesn't say takes as many as the stages always did.
    fn at_once(&self) -> usize {
        AT_ONCE
    }
}

/// Steps at once for a model without a cap of its own.
pub(crate) const AT_ONCE: usize = 3;

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

    fn at_once(&self) -> usize {
        self.inner.at_once()
    }
}

/// Where a step's stream goes, as it comes: the providers' own sink, so a
/// stage sees what the chat sees.
pub(crate) type Watch<'a> = aicompat::agent::EventSink<'a>;

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

    /// Takes six steps at once, as a provider with a higher cap does.
    struct Six;

    impl Model for Six {
        fn step<'a>(
            &'a self,
            _instructions: &'a str,
            _turns: &'a [AgentTurn],
            _tools: &'a [ToolSpec],
        ) -> BoxFuture<'a, Result<StepResult, String>> {
            Box::pin(async move { Ok(StepResult::Done(String::new())) })
        }

        fn at_once(&self) -> usize {
            6
        }
    }

    #[test]
    fn a_guided_model_takes_as_many_steps_at_once_as_its_provider() {
        let guided = Guided {
            inner: &Six,
            guidance: "",
        };
        assert_eq!(guided.at_once(), 6);
        assert_eq!(Echo.at_once(), AT_ONCE);
    }
}
