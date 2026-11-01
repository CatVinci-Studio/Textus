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
    /// The paper is written: its title and abstract, its sections and its
    /// reference list, as one text to propose.
    Ready {
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
    /// What the planner is thinking or writing, as it comes: the tail of
    /// it so far, sent a few times a second at most.
    Thinking {
        text: String,
    },
    /// Whether research can search the web: false when the model has no
    /// search of its own and Settings names no search service, so only the
    /// scholarly indexes and the user's library are searched.
    WebSearch {
        available: bool,
    },
    /// The research questions the topic was split into, in the order the
    /// helpers take them.
    Questions {
        questions: Vec<String>,
    },
    /// A research helper did something: what question `question` (its
    /// index) searched, read or kept.
    Activity {
        question: u32,
        kind: ActivityKind,
        detail: String,
    },
    /// The outline as the outliner writes it: its thesis once whole, and
    /// the titles of the sections given so far. `attempt` counts its tries;
    /// a try after the first follows one that was sent back.
    OutlineDraft {
        attempt: u32,
        thesis: Option<String>,
        titles: Vec<String>,
    },
    /// What section `index`'s writer has written so far, as it writes it:
    /// the whole of it, sent a few times a second at most. A try that starts
    /// over starts the text over. Sent once more with the section as kept
    /// when it is drafted or revised.
    SectionText {
        index: u32,
        text: String,
    },
    /// The sources the sections may cite, each as the reference list gives
    /// it after its number, and the list's heading: sent as drafting
    /// starts, so the document numbers its citations and lists them while
    /// the sections are written.
    Sources {
        heading: String,
        sources: Vec<SourceEntry>,
    },
    /// Question `question`'s helper finished, keeping `notes` notes;
    /// `failed` when it stopped on an error.
    QuestionDone {
        question: u32,
        notes: u32,
        failed: bool,
    },
}

/// A source of the paper: its number in the research's numbering, and its
/// entry in the reference list.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct SourceEntry {
    pub n: u32,
    pub entry: String,
}

/// What a research helper's step was.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub enum ActivityKind {
    /// A web search; `detail` is its queries.
    Search,
    /// A page read; `detail` is its address.
    Read,
    /// A scholarly search; `detail` is its query.
    Papers,
    /// The user's reference library searched or read; `detail` is the query
    /// or the path.
    Library,
    /// A note kept; `detail` is its claim.
    Note,
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
