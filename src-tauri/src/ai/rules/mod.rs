//! The deterministic writing-rules engine: the mechanical conventions of
//! the ten document languages, checked and fixed in code instead of being
//! left to a model that can't count characters or see a half-width comma
//! (CATALOGUE.md §3, decisions 5-6).
//!
//! - [`check`]: one paragraph's plain text, as the grammar check receives
//!   it - merged with the model's issues in `client::finish_grammar`.
//! - [`check_document`]: a whole Markdown document (code, math, front
//!   matter, link targets and HTML skipped), with the document-level and
//!   consistency rules - the `check_conventions` agent tool.
//! - [`postfix`]: the safe subsets applied to completions (CP) and to the
//!   text of edit proposals (PR), only where the document already follows
//!   the convention.
//! - [`measure`]: exact platform counts for the `measure_text` tool.
//!
//! Every rule has an id (`zh.punct.halfwidth`) and an entry in
//! [`registry`] with its priority: P0 runs at the "standard" grammar level
//! and its fix is safe; P1 runs at "standard" as one-by-one suggestions; P2
//! only at "strict", under a profile the user chose, or as document-level
//! consistency info. The "typos" level runs only spelling rules. Messages
//! are in the language of the text the rule fires on.

pub mod detect;
pub(crate) mod document;
pub mod measure;
mod messages;
pub mod postfix;
pub mod profile;
pub(crate) mod registry;
mod stats;
pub(crate) mod text;

mod de;
mod en;
mod es;
mod fr;
mod ja;
mod ko;
mod pt;
mod ru;
mod shared;
mod tw;
mod zh;
mod zhdata;

pub use detect::Lang;
pub use document::{check_document, DocReport};
pub use profile::{Conventions, Profile, ProjectConventions};
pub(crate) use stats::Stats;

use registry::{Category, RuleInfo};
use serde::Serialize;
use text::Text;

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Error,
    Warning,
    Info,
}

/// What can be done with a finding's suggestion.
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "lowercase")]
pub enum Fix {
    /// Safe to apply without review ("fix all", post-processing).
    Safe,
    /// A suggestion to review one by one.
    Suggest,
    /// Nothing to apply: the finding only flags.
    None,
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
#[cfg_attr(test, derive(specta::Type))]
pub enum Priority {
    P0,
    P1,
    P2,
}

/// The grammar check's strictness setting (grammarStrictness).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Level {
    Typos,
    Standard,
    Strict,
}

impl Level {
    pub fn from_setting(value: Option<&str>) -> Level {
        match value {
            Some("typos") => Level::Typos,
            Some("strict") => Level::Strict,
            _ => Level::Standard,
        }
    }
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[cfg_attr(test, derive(specta::Type))]
pub struct Finding {
    pub rule: &'static str,
    /// Unicode-scalar offsets into the checked text (the paragraph for
    /// [`check`], the Markdown source for [`check_document`]).
    pub start: usize,
    pub end: usize,
    pub original: String,
    pub suggestion: Option<String>,
    pub severity: Severity,
    pub fix: Fix,
    pub priority: Priority,
    pub message: String,
    /// 1-based line in the document ([`check_document`] only).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<usize>,
}

impl Finding {
    pub fn info(&self) -> &'static RuleInfo {
        registry::info(self.rule)
    }
}

/// What kind of block a text is - some rules apply only to headings, some
/// skip lists, quotations or table cells.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Block {
    Paragraph,
    Heading(u8),
    ListItem,
    Quote,
    TableCell,
    /// A paragraph from the grammar check: no Markdown context.
    Unknown,
}

impl Block {
    pub fn is_heading(self) -> bool {
        matches!(self, Block::Heading(_))
    }
}

/// What a rule knows besides the text.
pub(crate) struct Ctx<'a> {
    pub lang: Lang,
    /// The language a shared rule's message is written in: the app's, so a
    /// writer reads it in the language they chose - else the text's.
    pub messages: Lang,
    pub profile: &'a Profile,
    /// Convention counts for the document (or, in the grammar check, the
    /// paragraph): what "the document's own majority" means.
    pub stats: &'a Stats,
    pub block: Block,
    /// Library names and aliases (the project's people, places, terms).
    pub library: &'a [String],
}

/// Collects a rule's findings, dropping any that touch a protected span.
pub(crate) struct Out<'a> {
    t: &'a Text,
    pub found: Vec<Finding>,
}

impl<'a> Out<'a> {
    pub fn new(t: &'a Text) -> Self {
        Out {
            t,
            found: Vec::new(),
        }
    }

    pub fn add(
        &mut self,
        rule: &'static str,
        start: usize,
        end: usize,
        suggestion: Option<String>,
        message: impl Into<String>,
    ) {
        if start >= end || end > self.t.len() || self.t.guarded(start, end) {
            return;
        }
        let original = self.t.slice(start, end);
        if suggestion.as_deref() == Some(original.as_str()) {
            return;
        }
        let info = registry::info(rule);
        self.found.push(Finding {
            rule,
            start,
            end,
            original,
            suggestion,
            severity: info.severity,
            fix: info.fix,
            priority: info.priority,
            message: message.into(),
            line: None,
        });
    }

    /// A finding with a replacement.
    pub fn fix(
        &mut self,
        rule: &'static str,
        start: usize,
        end: usize,
        to: impl Into<String>,
        message: impl Into<String>,
    ) {
        self.add(rule, start, end, Some(to.into()), message);
    }

    /// A finding that only flags.
    pub fn flag(
        &mut self,
        rule: &'static str,
        start: usize,
        end: usize,
        message: impl Into<String>,
    ) {
        self.add(rule, start, end, None, message);
    }
}

/// Runs every rule for `ctx.lang` over one block.
pub(crate) fn run_rules(t: &Text, ctx: &Ctx, out: &mut Out) {
    shared::run(t, ctx, out);
    match ctx.lang {
        Lang::ZhHans | Lang::ZhHant => zh::run(t, ctx, out),
        Lang::En => en::run(t, ctx, out),
        Lang::Ja => ja::run(t, ctx, out),
        Lang::Ko => ko::run(t, ctx, out),
        Lang::Es => es::run(t, ctx, out),
        Lang::Fr => fr::run(t, ctx, out),
        Lang::De => de::run(t, ctx, out),
        Lang::Ru => ru::run(t, ctx, out),
        Lang::Pt => pt::run(t, ctx, out),
    }
}

/// Whether a rule runs at `level`. Document-level consistency info runs at
/// "standard" too, and so do rules gated on a profile the user chose.
pub(crate) fn allowed(info: &RuleInfo, level: Level, doc_level: bool) -> bool {
    match level {
        Level::Typos => info.category == Category::Spelling && info.priority != Priority::P2,
        Level::Standard => {
            info.priority != Priority::P2
                || info.gated
                || (doc_level && info.category == Category::Consistency)
        }
        Level::Strict => true,
    }
}

/// Sorted by position; of two findings that would both rewrite the same
/// characters, the one with the higher priority (then the earlier one)
/// stays. Flag-only findings never block a fix.
pub(crate) fn tidy(mut found: Vec<Finding>) -> Vec<Finding> {
    found.sort_by_key(|f| (f.start, f.priority, f.end));
    let mut kept: Vec<Finding> = Vec::new();
    for f in found {
        let clash = f.suggestion.is_some()
            && kept.iter().any(|k| {
                k.suggestion.is_some()
                    && k.start < f.end.max(f.start + 1)
                    && f.start < k.end.max(k.start + 1)
            });
        let same = kept
            .iter()
            .any(|k| k.rule == f.rule && k.start == f.start && k.end == f.end);
        if !clash && !same {
            kept.push(f);
        }
    }
    kept
}

/// One paragraph's findings for the grammar check: the language detected
/// from the text, the profile from `conv`, and only the rules that run in
/// the grammar check at `level`.
// The text's own language for messages; the app calls check_for.
#[cfg(test)]
pub fn check(text: &str, conv: &Conventions, level: Level, library: &[String]) -> Vec<Finding> {
    check_for(text, conv, level, library, None)
}

/// [`check`], with the shared rules' messages in the app's language
/// (`ui`, a code from src/i18n/langs.ts) rather than the text's.
pub fn check_for(
    text: &str,
    conv: &Conventions,
    level: Level,
    library: &[String],
    ui: Option<&str>,
) -> Vec<Finding> {
    let messages = ui.and_then(|code| Lang::ALL.into_iter().find(|l| l.ui_code() == code));
    check_as(
        text,
        detect::guess(text),
        conv,
        level,
        library,
        registry::GC,
        messages,
    )
}

pub(crate) fn check_as(
    text: &str,
    lang: Option<Lang>,
    conv: &Conventions,
    level: Level,
    library: &[String],
    site: u8,
    messages: Option<Lang>,
) -> Vec<Finding> {
    let t = Text::new(text);
    let Some(lang) = lang else {
        // Too short to tell the language: only what holds in every one.
        let profile = Profile::automatic(Lang::En);
        let stats = Stats::default();
        let ctx = Ctx {
            lang: Lang::En,
            messages: messages.unwrap_or(Lang::En),
            profile: &profile,
            stats: &stats,
            block: Block::Unknown,
            library,
        };
        let mut out = Out::new(&t);
        shared::nfc(&t, &ctx, &mut out);
        shared::double_space(&t, &ctx, &mut out);
        return finish(out.found, level, site, false);
    };
    let profile = conv.profile_for(lang);
    let mut stats = Stats::default();
    stats.count(&t, lang);
    let ctx = Ctx {
        lang,
        messages: messages.unwrap_or(lang),
        profile: &profile,
        stats: &stats,
        block: Block::Unknown,
        library,
    };
    let mut out = Out::new(&t);
    run_rules(&t, &ctx, &mut out);
    finish(out.found, level, site, false)
}

pub(crate) fn finish(found: Vec<Finding>, level: Level, site: u8, doc_level: bool) -> Vec<Finding> {
    tidy(
        found
            .into_iter()
            .filter(|f| {
                let info = f.info();
                info.sites & site != 0 && allowed(info, level, doc_level)
            })
            .collect(),
    )
}

/// Applies the findings' suggestions to `text` (char offsets), skipping
/// any that overlap one already applied.
pub fn apply(text: &str, findings: &[Finding]) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut fixes: Vec<&Finding> = findings
        .iter()
        .filter(|f| f.suggestion.is_some() && f.end <= chars.len())
        .collect();
    fixes.sort_by_key(|f| f.start);
    let mut out = String::new();
    let mut at = 0;
    for f in fixes {
        if f.start < at {
            continue;
        }
        out.extend(&chars[at..f.start]);
        out.push_str(f.suggestion.as_deref().unwrap_or_default());
        at = f.end;
    }
    out.extend(&chars[at..]);
    out
}

#[cfg(test)]
pub(crate) mod testing {
    //! Helpers for the per-language rule tests.
    use super::*;

    /// Findings of `rule` on `text` read as `lang` under `profile` (or
    /// Automatic), at every level, as (original, suggestion) pairs.
    pub fn hits(
        rule: &str,
        lang: Lang,
        profile: Option<&str>,
        text: &str,
    ) -> Vec<(String, Option<String>)> {
        hits_in(rule, lang, profile, text, Block::Unknown)
    }

    pub fn hits_in(
        rule: &str,
        lang: Lang,
        profile: Option<&str>,
        text: &str,
        block: Block,
    ) -> Vec<(String, Option<String>)> {
        findings(lang, profile, text, block)
            .into_iter()
            .filter(|f| f.rule == rule)
            .map(|f| (f.original, f.suggestion))
            .collect()
    }

    pub fn findings(lang: Lang, profile: Option<&str>, text: &str, block: Block) -> Vec<Finding> {
        let conv = Conventions {
            setting: profile.map(|p| serde_json::json!({ lang.code(): p })),
            ..Default::default()
        };
        let t = Text::new(text);
        let profile = conv.profile_for(lang);
        let mut stats = Stats::default();
        stats.count(&t, lang);
        let library = ["Elizabeth".to_string(), "林黛玉".to_string()];
        let ctx = Ctx {
            lang,
            messages: lang,
            profile: &profile,
            stats: &stats,
            block,
            library: &library,
        };
        let mut out = Out::new(&t);
        run_rules(&t, &ctx, &mut out);
        out.found
    }

    /// `text` with every fix of `rule` applied.
    pub fn fixed(rule: &str, lang: Lang, profile: Option<&str>, text: &str) -> String {
        let found: Vec<Finding> = findings(lang, profile, text, Block::Unknown)
            .into_iter()
            .filter(|f| f.rule == rule)
            .collect();
        apply(text, &found)
    }

    /// The pair list for one expected fix.
    pub fn one(original: &str, suggestion: &str) -> Vec<(String, Option<String>)> {
        vec![(original.to_string(), Some(suggestion.to_string()))]
    }

    pub fn flagged(original: &str) -> Vec<(String, Option<String>)> {
        vec![(original.to_string(), None)]
    }
}

#[cfg(test)]
mod tests;

#[cfg(test)]
mod sweep;
