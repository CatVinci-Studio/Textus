//! What kind of piece is written - a paper, a review, a report - and
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
    when: "the request asks for a paper, a thesis chapter or scholarly writing that argues a point, or its topic is a research question meant for specialists",
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

const REVIEW: Profile = Profile {
    name: "review",
    when: "a literature review, a survey of the research or the related-work chapter of a thesis: what has been studied on a question, with what methods and findings, and what remains open - 文献综述, 综述, 研究现状, 研究进展",
    chars: (5000, 10000),
    research_angles: "the field's foundational studies, its main approaches or schools of thought, the methods and data they use, the key findings and how they changed over time, where studies disagree and why, and the questions still open",
    research_sources: "Search the scholarly literature first, then the web for reviews and reports; read the best papers' abstracts and findings in full, and keep each study's result with add_note - who did it and when, with what method, data or sample, and what it found, with its figures; one study to a note. Prefer peer-reviewed papers, systematic reviews and meta-analyses, and cite a news or blog page only for a fact no paper gives. Say where studies disagree.",
    thesis: "a thesis - what the research as a whole shows on the question, and where its main gap is",
    outline_order: "organised by strand - a theme, an approach or a school of thought -, never study by study or question by question: open on the question, its scope and why it matters, then one section for each strand of the research, then where the strands disagree and why, and end on the gaps and the research they call for. Section titles name the strand, not a study",
    voice: "a literature review for researchers new to the question: synthesise, don't summarise. Group the studies that agree, set those that disagree against each other, and say what explains the difference - method, sample, period or setting. Name each study in the sentence by its authors or institution and year where the note gives them (\"Smith et al. (2021) found …\"), with its method and its key figure. Weigh the evidence: say which findings are well replicated, which rest on one study or a small sample, and what no study has yet shown. Never list one study after another, and never claim more than a study found.",
    cite: PAPER.cite,
    review_for: "the same study discussed in two sections, sections that contradict each other, a key point of the outline that no section makes, a figure the text never refers to, a claim stronger than what it cites; and what makes a review weak: a section that lists studies one after another without comparing them, a disagreement given without what explains it, a study named without its method or year, no section saying what remains open",
    opening: "The title names the question reviewed and its scope. The abstract, one paragraph of about 150-250 words (or 250-400 characters in Chinese or Japanese), states the question and its scope, the main strands of research, what they agree and disagree on, and the main gaps - from the paper's text only, without citations.",
    frame: Frame::Academic,
    scale: Scale {
        budget: (30, 50, 50, 4),
        figure_every: Some(3),
        ..LONG
    },
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

const ANALYSIS: Profile = Profile {
    name: "analysis",
    when: "a research or analysis report for decision-makers, with data and recommendations - a market, industry, policy or competitive analysis, a feasibility study, a white paper: 调研报告, 行业报告, 研究报告, 分析报告, 市场分析, 白皮书",
    chars: (5000, 10000),
    research_angles: "how big it is and how fast it is changing, its structure - the segments, the main players and their shares -, what drives it and what holds it back, the rules and policies that shape it, comparisons with other markets or periods, the risks, and what is likely in the next few years",
    research_sources: "Search the web, read the best pages in full, and keep every finding that answers it with add_note - figures with their unit, year, place and who measured them, not generalities. Prefer official statistics, regulators, company filings and annual reports, and established research firms and industry bodies. Say how a figure was defined when sources define it differently, and where estimates disagree keep each with its source.",
    thesis: "a thesis - the report's main finding in one sentence, as a decision-maker would act on it",
    outline_order: "with the conclusion first, as a research institute or a consultancy writes it: open on the key findings, then the context and the size, the analysis - structure, players, drivers, constraints, comparisons -, the risks and the outlook, and end on recommendations that follow from the findings. Section titles say what the section finds, not only its subject",
    voice: "clear, precise prose for a busy decision-maker, as a research institute's or a consultancy's report is written. Lead each section and each paragraph with its finding, then the evidence for it. Give figures exactly, with their unit, year and who measured them, and say what each means for the decision; compare them - over time, against peers - rather than list them. Keep apart what the data show, what is estimated and what is judgement, and say how certain each is. Recommendations are concrete - who should do what, and why - each resting on a finding. No marketing language, filler or summing up. In Chinese, write plain modern Chinese: no 此外, 综上所述 or 值得注意的是.",
    cite: PAPER.cite,
    review_for: "the same material in two sections, sections that contradict each other, a key point of the outline that no section makes, a figure the text never refers to, a claim stronger than what it cites; and what a decision-maker needs: a figure without its unit, year or source, two figures for the same thing that don't agree, a section that doesn't open on its finding, an estimate given as a fact, a recommendation no finding supports",
    opening: "The title says the report's main finding or the decision it informs, not only its subject. The abstract is the executive summary: one paragraph of about 120-200 words (or 200-350 characters in Chinese or Japanese) that gives the key findings with their figures and the main recommendation - from the text only, without citations.",
    frame: Frame::Executive,
    scale: Scale {
        budget: (50, 60, 10, 4),
        ..LONG
    },
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
    when: "only when the request asks for posts on a social network - a thread, tweets, X, Twitter, Weibo, 推文, 微博, 帖子 - told in a run of short posts",
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
    when: "a news story, a press release or a briefing of the day's news: what has just happened, told news-first in a few paragraphs - a news flash, 新闻稿, 快讯, 简报, 消息, a daily roundup, an automated report on an event, a release or a set of figures",
    chars: (300, 1500),
    research_angles: "what exactly happened, when and where, who is involved, the key number or statement, and what happens next - or, for a roundup of the day's news, the few most important stories, one question each",
    research_sources: "Search the web for the latest reporting and official statements, read the best pages in full, and keep each fact that answers it with add_note - who, what, when, where, the exact number or words, with the date it was published. Prefer the original announcement or a news agency; say where reports disagree.",
    thesis: "a thesis - the news in one plain sentence",
    outline_order: "as one section, the whole story: its key points from most to least important",
    voice: "a short news story as a news agency writes it, in the inverted pyramid: the first sentence says what happened, who, when and where - the most important fact first; the next one or two say why it matters and give the key number or quote; then the details and the background, most important first, and what happens next. Short paragraphs of one or two sentences, plain words, every term explained, the date of each event given; no opinion, no build-up, no summing up. Say who says a thing in the sentence itself. A roundup of several stories gives each its own short paragraphs, most important first, each opening on a bold lead-in of a few words that says what it is - never numbered posts.",
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
        match self {
            Genre::Paper => &PAPER,
            Genre::Review => &REVIEW,
            Genre::Report => &REPORT,
            Genre::Analysis => &ANALYSIS,
            Genre::Article => &ARTICLE,
            Genre::Thread => &THREAD,
            Genre::Brief => &BRIEF,
        }
    }
}
