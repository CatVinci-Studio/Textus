//! What a paper's run tells the frontend as it goes, over a Channel: the
//! progress card's phase, each section's state, the budget spent, and the
//! outline when it waits for the user.

use super::{BudgetCounts, Outline};
use serde::Serialize;

/// One update from `ai_paper_run`. Display only: what is kept is on disk.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum PaperEvent {
    Phase {
        phase: PaperPhase,
    },
    /// Section `index` of the outline is now `status`.
    Section {
        index: u32,
        status: SectionStatus,
    },
    Budget {
        used: BudgetCounts,
        remaining: BudgetCounts,
    },
    /// Section `index` is written, its heading first: the next to propose,
    /// sent in the outline's order.
    SectionDrafted {
        index: u32,
        markdown: String,
    },
    /// The paper's title and abstract: what goes above its first section,
    /// sent before it.
    Opening {
        markdown: String,
    },
    /// The list of the sources the paper cites: what goes below its last
    /// section, sent after it.
    References {
        markdown: String,
    },
    /// The outline is ready for the user to edit and approve.
    OutlineReady {
        outline: Outline,
    },
    /// A stage failed; `section` when it was one section's.
    Error {
        message: String,
        section: Option<u32>,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub enum PaperPhase {
    Planning,
    Researching,
    Outlining,
    /// Waiting for the user to approve the outline.
    AwaitingOutline,
    Drafting,
    Illustrating,
    Reviewing,
    Finishing,
    Done,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub enum SectionStatus {
    Waiting,
    Drafting,
    /// Written, held until the sections before it are proposed.
    Drafted,
    /// Sent to the document as a proposal.
    Proposed,
    Revising,
    Failed,
}
