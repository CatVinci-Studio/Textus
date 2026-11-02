//! What kind of piece is written - a paper, and the genres to come - and
//! how that changes each stage: what the research looks for, how the
//! outline is ordered, the writers' voice, what the review reads for and
//! what opens the piece. A genre is data, a `Profile`; the stages put its
//! parts into their prompts and keep their own checks.

use serde::{Deserialize, Serialize};

/// The kind of piece. Mirrored in src/platform/bindings/ai-paper.ts.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub enum Genre {
    /// A researched paper with a thesis, an abstract and numbered
    /// references.
    #[default]
    Paper,
}

/// What a genre puts into the stages' prompts.
pub(crate) struct Profile {
    /// What the piece is called in the prompts.
    pub name: &'static str,
    /// What its research questions cover between them.
    pub research_angles: &'static str,
    /// What a research helper reads and keeps, and which sources it prefers.
    pub research_sources: &'static str,
    /// The order its sections go in.
    pub outline_order: &'static str,
    /// How a section is written: its reader, its voice, what it makes of
    /// the notes.
    pub voice: &'static str,
    /// What the review reads the whole for.
    pub review_for: &'static str,
    /// What opens the piece, its title included; the step replies with
    /// `{"title", "abstract"}`.
    pub opening: &'static str,
}

const PAPER: Profile = Profile {
    name: "paper",
    research_angles: "background and definitions, how it works, the state of the art, the evidence and data, disputes and limits, cases, and where it is heading",
    research_sources: "Search the web and the scholarly literature, read the best pages in full, and keep every finding that answers it with add_note - specific claims with figures, dates, names and results, not generalities; prefer primary and scholarly sources, and say where sources disagree.",
    outline_order: "in an order that builds an argument: from context to mechanism, evidence, disputes and outlook, as the topic needs",
    voice: "substantial, specific prose for an informed reader - the notes' figures, dates, names and findings, explained and connected into an argument that serves the thesis, not a list of facts. Say where sources disagree and what the evidence can't show.",
    review_for: "the same material in two sections, sections that contradict each other, a key point of the outline that no section makes, a figure the text never refers to, a claim stronger than what it cites, a section that doesn't connect to the thesis or to the one before it",
    opening: "The title is specific and says what the paper finds or argues, not only its topic. The abstract, one paragraph of about 150-250 words (or 250-400 characters in Chinese or Japanese), states the question, the approach, the main findings with their key figures, and what follows from them - from the paper's text only, without citations.",
};

impl Genre {
    pub(crate) fn profile(self) -> &'static Profile {
        match self {
            Genre::Paper => &PAPER,
        }
    }
}
