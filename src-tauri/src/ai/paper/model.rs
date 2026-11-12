//! What Research adds to the agent's model (`agent::Model`): a paper's
//! budget on every step, and the one-line detail its card shows.

use super::budget::{BudgetKind, SharedBudget, STEPS_SPENT};
pub(crate) use crate::ai::agent::{Model, Watch};
use aicompat::agent::{AgentTurn, StepResult, ToolSpec};
use futures_util::future::BoxFuture;

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

    fn at_once(&self) -> usize {
        self.inner.at_once()
    }
}

/// The longest an activity's detail is sent: the card shows one line.
const DETAIL_CHARS: usize = 120;

pub(crate) fn clip(text: &str) -> String {
    let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    crate::ai::clip(&text, DETAIL_CHARS - 1)
}
