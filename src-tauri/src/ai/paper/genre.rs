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
    /// A feature for a newsletter or a WeChat official account: a few
    /// thousand characters, crossheads, a headline and a standfirst.
    Article,
    /// A thread of numbered posts for X (Twitter) or Weibo, each short
    /// enough for one post.
    Thread,
    /// A short news story of a few hundred characters: the news first,
    /// for quick, automated reporting.
    Brief,
}

/// What the app does differently for a genre. Mirrored in
/// src/platform/bindings/ai-paper.ts.
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct GenreForm {
    /// Whether the user approves its outline; false for a piece written
    /// straight on.
    pub checkpoint: bool,
    /// Whether its sections go under headings of their own; false for a
    /// piece of one section, all under its title.
    pub headings: bool,
}

/// How a piece is set around its sections.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Frame {
    /// An abstract labelled as one, and a list of references.
    Academic,
    /// A standfirst in bold with no label, and a list of sources.
    News,
    /// Only a headline, and a list of sources.
    Headline,
}

/// How big a genre's piece is and how it is made.
pub(crate) struct Scale {
    /// Research questions, at least and at most.
    pub questions: (usize, usize),
    /// What its research may spend: searches, page reads, scholarly
    /// lookups and generated pictures.
    pub budget: (u32, u32, u32, u32),
    /// Sections, at least and at most, and about how many characters each.
    pub sections: (usize, usize),
    pub chars_per_section: u32,
    /// One figure at least for every this many sections; None for a piece
    /// with no figures.
    pub figure_every: Option<usize>,
    /// Whether the user approves its outline before it is written.
    pub checkpoint: bool,
    /// A post's most characters, when the piece is a thread of posts.
    pub post_chars: Option<u32>,
}

/// A paper's and a long read's scale.
const LONG: Scale = Scale {
    questions: (4, 10),
    budget: (40, 60, 30, 6),
    sections: (3, 12),
    chars_per_section: 800,
    figure_every: Some(2),
    checkpoint: true,
    post_chars: None,
};

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
    pub scale: Scale,
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
    scale: LONG,
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
    scale: LONG,
};

const ARTICLE: Profile = Profile {
    name: "article",
    when: "a piece for a newsletter, a blog or a WeChat official account (公众号): explaining a topic, a trend or a piece of news to followers in a few thousand characters",
    chars: (1500, 4000),
    research_angles: "what is happening and why readers should care, the background in brief, the facts and numbers that matter, a case or a voice that brings it to life, and what it means for the reader",
    research_sources: REPORT.research_sources,
    thesis: REPORT.thesis,
    outline_order: "ordered so it reads straight through: a hook on something concrete, why it matters, then what a reader needs to understand it, and an ending that leaves them with what it means for them. Section titles are short, lively crossheads",
    voice: "lively, warm and clear prose for followers reading on a phone - a good newsletter or 公众号 feature, never a report or an essay. Short paragraphs of one to three sentences; one idea each. Explain every term the first time in plain words; a number only where it tells, rounded and put in terms a reader can picture. Use a case, a scene or a quote from the notes to bring the point to life, and say who says a thing in the sentence itself. Talk to the reader directly where it helps. No jargon, padding, clickbait or summing up. In Chinese, write natural modern Chinese as the best 公众号 do: no translationese, no strings of set four-character phrases, no 此外, 综上所述 or 值得注意的是.",
    cite: REPORT.cite,
    review_for: REPORT.review_for,
    opening: "The title is a headline that makes a reader on a phone want to tap: concrete and in plain words, honest about what the piece says - no clickbait, no colon and subtitle. The abstract is the line under it: one sentence, at most 30 words (or 50 characters in Chinese or Japanese), that says why this is worth their time - from the text only, without citations.",
    frame: Frame::News,
    scale: Scale {
        questions: (3, 5),
        budget: (15, 20, 5, 3),
        sections: (2, 6),
        chars_per_section: 600,
        figure_every: Some(3),
        checkpoint: false,
        post_chars: None,
    },
};

const THREAD: Profile = Profile {
    name: "thread",
    when: "a thread for X (Twitter), Weibo or another social network: a topic or a piece of news told in a run of short posts",
    chars: (600, 2500),
    research_angles: "what happened and why it matters, the most striking facts and numbers, a case or a quote, and what comes next",
    research_sources: REPORT.research_sources,
    thesis: "a thesis - the thread's point in one plain sentence",
    outline_order: "as one section, the whole thread: its key points in the order the posts make them, the first a hook that makes people read on",
    voice: "a thread of numbered posts, the way a good journalist or explainer writes one on X: the first post a hook that says what the thread is about and why it matters, each post after it one point - a fact, a number put in everyday terms, a case, a quote - and the last what it means or what comes next. Each post stands on its own, in plain words for anyone scrolling by; explain every term in a few words. Begin each post with its number and a slash (\"1/\"), and put a line with only --- between posts. No hashtags unless the topic has one everyone uses, no emoji chains, no filler.",
    cite: "Mark the post a fact from a note is in with its source at the post's end as [n](address), exactly as the note gives it - at most two a post - and cite nothing else.",
    review_for: "a post that repeats another, posts that contradict each other, a key point no post makes, a claim stronger than what it cites, a post a reader scrolling by couldn't follow on its own, a first post that doesn't make people read on",
    opening: "The title is a short, plain headline for the thread as a whole, to name it in the document. The abstract is empty.",
    frame: Frame::Headline,
    scale: Scale {
        questions: (2, 4),
        budget: (10, 12, 0, 0),
        sections: (1, 1),
        chars_per_section: u32::MAX,
        figure_every: None,
        checkpoint: false,
        post_chars: Some(280),
    },
};

const BRIEF: Profile = Profile {
    name: "brief",
    when: "a quick news story or update: what has just happened, told in a few paragraphs - a news flash, a daily update, an automated report on an event, a release or a set of figures",
    chars: (300, 1000),
    research_angles: "what exactly happened, when and where, who is involved, the key number or statement, and what happens next",
    research_sources: "Search the web for the latest reporting and official statements, read the best pages in full, and keep each fact that answers it with add_note - who, what, when, where, the exact number or words, with the date it was published. Prefer the original announcement or a news agency; say where reports disagree.",
    thesis: "a thesis - the news in one plain sentence",
    outline_order: "as one section, the whole story: its key points from most to least important",
    voice: "a short news story as a news agency writes it, in the inverted pyramid: the first sentence says what happened, who, when and where - the most important fact first; the next one or two say why it matters and give the key number or quote; then the details and the background, most important first, and what happens next. Short paragraphs of one or two sentences, plain words, every term explained, the date of each event given; no opinion, no build-up, no summing up. Say who says a thing in the sentence itself.",
    cite: REPORT.cite,
    review_for: "a first sentence that doesn't give the news, a fact the story gives twice, a claim stronger than what it cites, a term never explained, a date missing from an event",
    opening: "The title is a news headline: short, in the present tense, saying what happened. The abstract is empty.",
    frame: Frame::Headline,
    scale: Scale {
        questions: (1, 3),
        budget: (8, 10, 0, 0),
        sections: (1, 1),
        chars_per_section: u32::MAX,
        figure_every: None,
        checkpoint: false,
        post_chars: None,
    },
};

impl Genre {
    /// Every genre, in the order the choosing step is told them.
    pub(crate) const ALL: [Genre; 5] = [
        Genre::Paper,
        Genre::Report,
        Genre::Article,
        Genre::Thread,
        Genre::Brief,
    ];

    pub(crate) fn form(self) -> GenreForm {
        let scale = &self.profile().scale;
        GenreForm {
            checkpoint: scale.checkpoint,
            headings: scale.sections.1 > 1,
        }
    }

    /// Its length: `chars` brought within its lengths, or with none asked
    /// for, their middle.
    pub(crate) fn length(self, chars: Option<u32>) -> u32 {
        let (least, most) = self.profile().chars;
        chars.map_or((least + most) / 2, |c| self.fit(c))
    }

    /// `chars` brought within this genre's lengths.
    pub(crate) fn fit(self, chars: u32) -> u32 {
        let (least, most) = self.profile().chars;
        chars.clamp(least, most)
    }

    pub(crate) fn profile(self) -> &'static Profile {
        match self {
            Genre::Paper => &PAPER,
            Genre::Report => &REPORT,
            Genre::Article => &ARTICLE,
            Genre::Thread => &THREAD,
            Genre::Brief => &BRIEF,
        }
    }
}
