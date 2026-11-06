//! What kind of piece is written - a paper, a review, a report - and
//! how that changes each stage: what the research looks for, how the
//! outline is ordered, the writers' voice, what the review reads for and
//! what opens the piece. A genre is data, a `Profile` - its words in
//! prompts/genres/, its sizes here; the stages put its parts into their
//! prompts and keep their own checks.

use super::prompts;
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;

/// The kind of piece. Mirrored in src/platform/bindings/ai-paper.ts.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub enum Genre {
    /// A researched paper with a thesis, an abstract and numbered
    /// references.
    #[default]
    Paper,
    /// A literature review: what the research on a question has found,
    /// strand by strand, and what it leaves open.
    Review,
    /// A long read for the general reader, as a news organisation writes
    /// one: a headline, a standfirst, and its sources named in the text.
    Report,
    /// An analysis for decision-makers - of a market, an industry or a
    /// policy: an executive summary, the findings first, recommendations.
    Analysis,
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
    /// An executive summary labelled as one, and a list of sources.
    Executive,
}

/// How big a genre's piece is and how it is made.
#[derive(Clone, Copy)]
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

/// What a genre puts into the stages' prompts. Its words are in
/// prompts/genres/<name>.md, one part a heading; its sizes are here.
pub(crate) struct Profile {
    /// What the piece is called in the prompts, and its file's name.
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

/// A genre's name, length, frame and scale: what isn't words.
struct Sizes {
    name: &'static str,
    chars: (u32, u32),
    frame: Frame,
    scale: Scale,
}

const PAPER: Sizes = Sizes {
    name: "paper",
    chars: (5000, 10000),
    frame: Frame::Academic,
    scale: LONG,
};

const REVIEW: Sizes = Sizes {
    name: "review",
    chars: (5000, 10000),
    frame: Frame::Academic,
    scale: Scale {
        budget: (30, 50, 50, 4),
        figure_every: Some(3),
        ..LONG
    },
};

const REPORT: Sizes = Sizes {
    name: "report",
    chars: (5000, 10000),
    frame: Frame::News,
    scale: LONG,
};

const ANALYSIS: Sizes = Sizes {
    name: "analysis",
    chars: (5000, 10000),
    frame: Frame::Executive,
    scale: Scale {
        budget: (50, 60, 10, 4),
        ..LONG
    },
};

const ARTICLE: Sizes = Sizes {
    name: "article",
    chars: (1500, 4000),
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

const THREAD: Sizes = Sizes {
    name: "thread",
    chars: (600, 2500),
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

const BRIEF: Sizes = Sizes {
    name: "brief",
    chars: (300, 1500),
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

impl Sizes {
    /// Its profile: these sizes, and its words from its file.
    fn profile(&self) -> Profile {
        let part = |part: &str| prompts::get(&format!("genre.{}.{part}", self.name));
        Profile {
            name: self.name,
            when: part("when"),
            chars: self.chars,
            research_angles: part("research_angles"),
            research_sources: part("research_sources"),
            thesis: part("thesis"),
            outline_order: part("outline_order"),
            voice: part("voice"),
            cite: part("cite"),
            review_for: part("review_for"),
            opening: part("opening"),
            frame: self.frame,
            scale: self.scale,
        }
    }
}

impl Genre {
    /// Every genre, in the order the choosing step is told them.
    pub(crate) const ALL: [Genre; 7] = [
        Genre::Paper,
        Genre::Review,
        Genre::Report,
        Genre::Analysis,
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
        static PROFILES: OnceLock<[Profile; 7]> = OnceLock::new();
        let all = PROFILES.get_or_init(|| {
            [PAPER, REVIEW, REPORT, ANALYSIS, ARTICLE, THREAD, BRIEF].map(|s| s.profile())
        });
        &all[self as usize]
    }
}
