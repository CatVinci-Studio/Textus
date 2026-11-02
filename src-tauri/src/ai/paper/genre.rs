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
    /// A long read for the general reader, as a news organisation writes
    /// one: a headline, a standfirst, and its sources named in the text.
    Report,
}

/// How a piece is set around its sections.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Frame {
    /// An abstract labelled as one, and a list of references.
    Academic,
    /// A standfirst in bold with no label, and a list of sources.
    News,
}

/// What a genre puts into the stages' prompts.
pub(crate) struct Profile {
    /// What the piece is called in the prompts.
    pub name: &'static str,
    /// When a request calls for it, as the step choosing a genre reads it.
    pub when: &'static str,
    /// Its length in characters, at least and at most.
    pub chars: (u32, u32),
    /// What its research questions cover between them.
    pub research_angles: &'static str,
    /// What a research helper reads and keeps, and which sources it prefers.
    pub research_sources: &'static str,
    /// What the outline's thesis is.
    pub thesis: &'static str,
    /// The order its sections go in.
    pub outline_order: &'static str,
    /// How a section is written: its reader, its voice, what it makes of
    /// the notes.
    pub voice: &'static str,
    /// How its text marks where a fact comes from.
    pub cite: &'static str,
    /// What the review reads the whole for.
    pub review_for: &'static str,
    /// What opens the piece, its title included; the step replies with
    /// `{"title", "abstract"}`.
    pub opening: &'static str,
    pub frame: Frame,
}

const PAPER: Profile = Profile {
    name: "paper",
    when: "the request asks for a paper, a literature review, a thesis chapter or scholarly writing, or its topic is a research question meant for specialists",
    chars: (5000, 10000),
    research_angles: "background and definitions, how it works, the state of the art, the evidence and data, disputes and limits, cases, and where it is heading",
    research_sources: "Search the web and the scholarly literature, read the best pages in full, and keep every finding that answers it with add_note - specific claims with figures, dates, names and results, not generalities; prefer primary and scholarly sources, and say where sources disagree.",
    thesis: "a thesis",
    outline_order: "in an order that builds an argument: from context to mechanism, evidence, disputes and outlook, as the topic needs",
    voice: "substantial, specific prose for an informed reader - the notes' figures, dates, names and findings, explained and connected into an argument that serves the thesis, not a list of facts. Say where sources disagree and what the evidence can't show.",
    cite: "Mark every fact from a note with its source right after it as [n](address), exactly as the note gives it, and cite nothing else.",
    review_for: "the same material in two sections, sections that contradict each other, a key point of the outline that no section makes, a figure the text never refers to, a claim stronger than what it cites, a section that doesn't connect to the thesis or to the one before it",
    opening: "The title is specific and says what the paper finds or argues, not only its topic. The abstract, one paragraph of about 150-250 words (or 250-400 characters in Chinese or Japanese), states the question, the approach, the main findings with their key figures, and what follows from them - from the paper's text only, without citations.",
    frame: Frame::Academic,
};

const REPORT: Profile = Profile {
    name: "report",
    when: "a long read for the general public on news, current affairs, a place, a person, a trend or how something works - in-depth journalism as the BBC, Reuters or a magazine writes it",
    chars: (5000, 10000),
    research_angles: "what is happening and why it matters now, who it affects and how - real people, places and cases -, the background a newcomer needs, the numbers that matter and what they mean in everyday terms, what the different sides and independent experts say, and what happens next",
    research_sources: "Search the web, read the best pages in full, and keep every finding that answers it with add_note - specific facts with dates, names, places and numbers, not generalities. Prefer original reporting by established news organisations, official statements and documents, and named experts; keep what people said word for word as the note's quote, saying who said it and their role, since real cases and voices carry a report. Say where sources disagree.",
    thesis: "a thesis - the story's main line in one plain sentence: what is happening and why it matters",
    outline_order: "ordered as a story, not a textbook: open on what is happening now, or on one person, place or moment that shows it, then why it matters, then the background, the evidence and the views that compete, and end on what comes next - as the topic needs. Section titles are short, plain crossheads a reader understands on their own, not academic headings",
    voice: "clear, vivid prose for a general reader new to the subject, the way a BBC or Reuters long read is written - the notes' facts, made easy to follow. Lead each paragraph with its point, one idea to a paragraph, two to four sentences long, in sentences that can be read aloud. Explain every technical term, acronym, institution and person the first time they appear, in a few plain words. Use a number only where it matters, at most two to a sentence, rounded and put in terms a reader can picture (\"about one in four\", \"twice the 2015 level\"), never a run of percentages. Bring in the people and cases from the notes, with their words quoted exactly and who said them. Say who says a thing in the sentence itself (\"the city's health department says\", \"a 2023 Reuters investigation found\"), so a reader knows where it comes from without the mark. Where sources disagree, give each side fairly; where the evidence is thin, say so in one plain sentence. Begin on something concrete and end on a line that leads on. No jargon, chains of hedges, filler or summing up (\"in conclusion\", \"overall\"). In Chinese, write natural modern Chinese as a good newspaper does: no translationese, no strings of set four-character phrases, no 此外, 综上所述 or 值得注意的是, and dates in the Western calendar.",
    cite: "Mark each sentence that rests on a note with its source at the sentence's end as [n](address), exactly as the note gives it - once a sentence, not after every number - and cite nothing else.",
    review_for: "the same material in two sections, sections that contradict each other, a key point of the outline that no section makes, a figure the text never refers to, a claim stronger than what it cites; and what a reader new to the subject would stumble on: a term, acronym or name never explained, a paragraph crowded with numbers, sentences too long to read aloud, academic or official language, a section that begins without leading on from the one before it, an opening that doesn't start with what matters",
    opening: "The title is a headline: short, concrete and in plain words, saying what is happening rather than naming the topic, with no colon and subtitle. The abstract is the standfirst under it: one or two sentences, at most 50 words (or 80 characters in Chinese or Japanese), that tell a reader why this matters to them and make them read on - from the text only, without citations.",
    frame: Frame::News,
};

impl Genre {
    /// Every genre, in the order the choosing step is told them.
    pub(crate) const ALL: [Genre; 2] = [Genre::Paper, Genre::Report];

    /// `chars` brought within this genre's lengths.
    pub(crate) fn fit(self, chars: u32) -> u32 {
        let (least, most) = self.profile().chars;
        chars.clamp(least, most)
    }

    pub(crate) fn profile(self) -> &'static Profile {
        match self {
            Genre::Paper => &PAPER,
            Genre::Report => &REPORT,
        }
    }
}
