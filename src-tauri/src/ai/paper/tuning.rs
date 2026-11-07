//! The numbers the paper's stages are tuned by, in one place. A genre's
//! own sizes - its questions, sections and research budget - are in its
//! `Scale` (genre.rs); these hold for every genre.

// Research.

/// Helpers researching at once.
pub(super) const RESEARCHERS_AT_ONCE: usize = 4;
/// A helper's steps: a few searches and reads, and its notes.
pub(super) const HELPER_STEPS: usize = 10;
/// Parts of its question one researcher may hand to helpers of its own,
/// when the user lets it (not yet tried on a live model).
pub(super) const MAX_HANDED: usize = 2;
/// A part's helper's steps: fewer than a question's, for a narrower one.
pub(super) const SUB_STEPS: usize = 6;
/// Questions a research plan may give at most, whatever the genre.
pub(super) const MAX_QUESTIONS: usize = 10;
/// Characters of each attached file the research plan sees; the helpers
/// read them whole.
pub(super) const PLAN_GLIMPSE: usize = 1_500;

// Outline.

/// Tries at an outline that holds.
pub(super) const OUTLINE_STEPS: usize = 5;
/// The fewest sections an outline may have below its most: a few fewer,
/// longer sections are fine, a list of short ones isn't.
pub(super) const SECTIONS_SLACK: usize = 2;
/// Figures an outline may plan beyond one a section.
pub(super) const FIGURES_BEYOND_SECTIONS: usize = 1;
/// Web pictures: at most one for every this many sections - each needs a
/// match on Commons, and too many crowd out the figures of the paper's own
/// data.
pub(super) const SECTIONS_PER_WEB_PICTURE: usize = 3;
/// How far the outline's section lengths may add up from the paper's, as
/// fractions of it.
pub(super) const OUTLINE_LENGTH: (f64, f64) = (0.5, 1.6);

// Drafting.

/// A writer's tries at a section that holds.
pub(super) const WRITER_STEPS: usize = 5;
/// How far a section's length may be from its target, as fractions of it:
/// within PASS it holds; within SOFT it is kept if nothing else is wrong
/// (a writer's last try); beyond, it is sent back.
pub(super) const PASS: (f64, f64) = (0.7, 1.2);
pub(super) const SOFT: (f64, f64) = (0.5, 1.4);

// Review.

/// Tries at a review report that reads.
pub(super) const REVIEW_STEPS: usize = 3;
/// Points kept against one section: the most important, as the reviewer
/// ordered them.
pub(super) const MAX_POINTS_PER_SECTION: usize = 3;

// Figures.

/// Commons search results tried for one web picture before it is left out.
pub(super) const COMMONS_TRIES: usize = 3;
