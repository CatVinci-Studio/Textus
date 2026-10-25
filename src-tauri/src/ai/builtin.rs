//! The skills and writing-standards reference packs bundled with the app.
//!
//! ```text
//! skills/
//! ├── expand.md … skill.md               <- the built-in skills (SKILL_FILES)
//! ├── packs/                             <- the reference packs (PACK_FILES)
//! │   ├── contract.md                    <- the editing contract every built-in follows
//! │   ├── craft.md                       <- fiction, plain language, email, platforms
//! │   └── standards-<lang>.md            <- one per document language
//! └── ATTRIBUTION.md                     <- credits for the adapted texts
//! ```
//!
//! All of it is compiled in with `include_str!`, like ui-names/*.txt, so it
//! needs no resource path or file access (iOS included) and the app never
//! writes it. A skill is an Agent Skills file (frontmatter + body, parsed
//! by workspace::parse_skill_file); the user's global skills/ and the
//! project's .textus/skills/ override a built-in of the same name
//! (workspace::load_layers) and Customize… copies one there. Each panel
//! mode has its own (`textus-modes`), always on; the other skills come from
//! the market (plugins::catalog) and are the user's own files.
//!
//! A pack is split into `## sections` with the same names in every
//! language's pack (`typography`, `numbers`, `words`, `dialogue`,
//! `register`, `letters`, `official`, `academic`, `social`, `ai-tells`), so
//! a skill asks for `standards#dialogue` whatever the document's language.
//! The sections a skill lists in `textus-packs` are appended to its body
//! when it is used - by `/name` (expand_message) or use_skill - so there is
//! no second round trip to fetch them; the model can also load any section
//! with `use_skill("standards-fr#dialogue")` (load_reference).

use crate::ai::workspace::{parse_skill_file, AgentSkill, Invocation, SkillSource};
use std::sync::OnceLock;

mod packs;
pub(crate) use packs::*;
mod language;
pub(crate) use language::*;
mod expand;
pub(crate) use expand::*;

macro_rules! bundled {
    ($dir:literal; $($name:literal),* $(,)?) => {
        &[$(($name, include_str!(concat!($dir, $name, ".md")))),*]
    };
}

/// The built-in skills, by file stem (which is also each skill's name):
/// Write's, Review's and Create's, in that order.
pub(crate) const SKILL_FILES: &[(&str, &str)] = bundled!("skills/";
    "expand",
    "tighten",
    "translate",
    "summarize",
    "proofread",
    "continuity",
    "theme",
    "plugin",
    "skill",
);

/// The skills that were built in until 1.3 and are in the market now: a
/// profile from before then gets the ones it had on installed from there
/// (workspace::moved::install_moved_skills).
pub(crate) const MOVED_TO_MARKET: &[&str] = &[
    "continue-story",
    "describe",
    "dialogue",
    "imitate-style",
    "change-tone",
    "de-ai",
    "email",
    "notice",
    "minutes",
    "academic-polish",
    "social-post",
    "headline",
];

/// The reference packs, by file stem (= the name use_skill loads them by).
pub(crate) const PACK_FILES: &[(&str, &str)] = bundled!("skills/packs/";
    "contract",
    "craft",
    "standards-en",
    "standards-zh-hans",
    "standards-zh-hant",
    "standards-ja",
    "standards-ko",
    "standards-es",
    "standards-fr",
    "standards-de",
    "standards-ru",
    "standards-pt",
);

/// Credits for the adapted texts in the skills and packs (also shown in
/// Help > Acknowledgements).
pub(crate) const ATTRIBUTION: &str = include_str!("skills/ATTRIBUTION.md");

/// ATTRIBUTION.md as Markdown, for Help > Acknowledgements.
#[tauri::command]
pub fn builtin_skills_attribution() -> &'static str {
    ATTRIBUTION
}

/// The `/` menu's groups, in menu order (`textus-category`).
pub(crate) const CATEGORY_ORDER: &[&str] = &["write", "revise", "check", "format", "create"];

/// The built-in skills, parsed once.
pub(crate) fn skills() -> &'static [AgentSkill] {
    static SKILLS: OnceLock<Vec<AgentSkill>> = OnceLock::new();
    SKILLS.get_or_init(|| {
        SKILL_FILES
            .iter()
            .map(|(stem, text)| AgentSkill {
                source: SkillSource::Builtin,
                ..parse_skill_file(stem, text)
            })
            .collect()
    })
}

/// The built-in skill called `name`.
pub(crate) fn find(name: &str) -> Option<&'static AgentSkill> {
    skills().iter().find(|s| s.name == name)
}

/// A built-in skill's file as bundled (what Customize… copies).
pub(crate) fn raw(name: &str) -> Option<&'static str> {
    SKILL_FILES
        .iter()
        .find(|(stem, _)| *stem == name)
        .map(|(_, text)| *text)
}

/// A built-in skill's file with `textus-based-on` added under `metadata:`,
/// for the copy Customize… writes.
pub(crate) fn with_based_on(raw: &str, based_on: &str) -> String {
    let line = format!("  textus-based-on: \"{based_on}\"");
    let mut out = Vec::new();
    let mut added = false;
    for l in raw.lines() {
        out.push(l.to_string());
        if !added && l.trim_end() == "metadata:" {
            out.push(line.clone());
            added = true;
        }
    }
    let mut text = out.join("\n");
    if raw.ends_with('\n') {
        text.push('\n');
    }
    text
}

#[cfg(test)]
mod tests;
