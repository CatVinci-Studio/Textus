//! Every rule the engine ships, with its priority, category, severity, fix kind
//! and run sites. Rules only report an id; callers filter on what is here.

use super::{Fix, Priority, Severity};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Category {
    /// Typo lists and misspellings - the only rules the "typos" level runs.
    Spelling,
    Punctuation,
    Spacing,
    Characters,
    Numbers,
    Words,
    Style,
    Script,
    Structure,
    /// Mixed conventions in one document.
    Consistency,
}

/// Where a rule runs: the grammar check, the document check, completion and
/// proposal post-processing.
pub const GC: u8 = 1;
pub const DOC: u8 = 2;
pub const CP: u8 = 4;
pub const PR: u8 = 8;

pub struct RuleInfo {
    pub id: &'static str,
    pub priority: Priority,
    pub category: Category,
    pub severity: Severity,
    pub fix: Fix,
    pub sites: u8,
    /// Runs only under a profile or option the user chose (gongwen,
    /// newmedia, GOV.UK...): a P2 rule of this kind runs at "standard",
    /// since choosing the profile asked for it.
    pub gated: bool,
}

use Category::*;
use Fix::{None as NoFix, Safe, Suggest};
use Priority::*;
use Severity::*;

macro_rules! rules {
    ($($id:literal $pri:ident $cat:ident $sev:ident $fix:ident [$($site:ident)|+] $($gated:ident)?;)*) => {
        pub const RULES: &[RuleInfo] = &[$(RuleInfo {
            id: $id,
            priority: $pri,
            category: $cat,
            severity: $sev,
            fix: $fix,
            sites: 0 $(| $site)+,
            gated: rules!(@gated $($gated)?),
        }),*];
    };
    (@gated) => { false };
    (@gated gated) => { true };
}

rules! {
    // Shared (all languages)
    "shared.nfc" P0 Characters Warning Safe [GC | DOC | CP | PR];
    "shared.space-before-punct" P0 Spacing Error Safe [GC | DOC];
    "shared.double-space" P1 Spacing Warning Safe [GC | DOC];
    "shared.doubled-word" P1 Spelling Warning Suggest [GC | DOC];
    "shared.residue" P1 Style Warning NoFix [DOC | PR];
    "shared.library-name" P1 Spelling Warning Suggest [GC | DOC];
    "shared.heading-structure" P2 Structure Info NoFix [DOC];
    "shared.image-alt" P2 Structure Info NoFix [DOC];

    // Simplified Chinese (and the region-neutral Chinese rules)
    "zh.punct.halfwidth" P0 Punctuation Error Safe [GC | DOC | CP | PR];
    "zh.space.fullwidth-adjacent" P0 Spacing Error Safe [GC | DOC | PR];
    "zh.punct.ellipsis" P0 Punctuation Error Safe [GC | DOC | CP | PR];
    "zh.punct.ellipsis-deng" P0 Punctuation Error Safe [GC | DOC];
    "zh.punct.dash" P1 Punctuation Warning Suggest [GC | DOC];
    "zh.punct.stacked" P1 Punctuation Warning Suggest [GC | DOC];
    "zh.heading.end-punct" P1 Punctuation Warning Safe [GC | DOC];
    "zh.quote.straight" P1 Punctuation Warning Suggest [GC | DOC];
    "zh.space.cjk-latin" P1 Spacing Warning Suggest [GC | DOC | CP];
    "zh.width.alnum" P0 Characters Error Safe [GC | DOC | PR];
    "zh.num.decimal" P1 Numbers Error Suggest [GC | DOC];
    "zh.num.approx" P1 Numbers Warning Suggest [GC | DOC];
    "zh.title.dunhao" P2 Punctuation Warning Suggest [GC | DOC];
    "zh.num.mixed-date" P1 Numbers Warning NoFix [GC | DOC];
    "zh.num.short-year" P2 Numbers Info NoFix [GC | DOC];
    "zh.num.mixed-unit" P1 Numbers Warning Suggest [GC | DOC];
    "zh.date.dunhao" P2 Numbers Info Suggest [GC | DOC];
    "zh.punct.middot" P1 Punctuation Warning Suggest [GC | DOC];
    "zh.word.typo" P0 Spelling Error Safe [GC | DOC];
    "zh.word.variant" P2 Words Info Suggest [GC | DOC];
    "zh.script.mixed" P1 Script Warning Suggest [GC | DOC];
    "zh.num.unit-space" P2 Spacing Info Suggest [GC | DOC];
    "zh.num.ascii-range" P2 Numbers Info Suggest [GC | DOC];
    "zh.style.clause-length" P2 Style Info NoFix [DOC];
    "zh.compat-ideograph" P0 Characters Error Safe [GC | DOC];
    "zh.gongwen.docnum" P1 Numbers Error Suggest [GC | DOC] gated;
    "zh.gongwen.date" P1 Numbers Error Suggest [GC | DOC] gated;
    "zh.gongwen.title" P1 Structure Warning NoFix [DOC] gated;
    "zh.gongwen.report-request" P1 Structure Warning NoFix [DOC] gated;
    "zh.ad.absolute" P1 Words Warning NoFix [GC | DOC] gated;
    "zh.ad.health" P2 Words Warning NoFix [GC | DOC] gated;
    "zh.ad.unsourced" P2 Words Info NoFix [DOC] gated;

    // Traditional Chinese
    "tw.quote.corner" P1 Punctuation Warning Suggest [GC | DOC];
    "tw.punct.middot" P2 Punctuation Info Suggest [GC | DOC] gated;
    "tw.punct.dash" P2 Consistency Info Suggest [DOC];
    "tw.script.simplified" P1 Script Warning Suggest [GC | DOC];
    "tw.script.hk-mix" P1 Script Warning Suggest [GC | DOC];
    "tw.word.mainland" P2 Words Info Suggest [GC | DOC];
    "tw.gongwen.legal-chars" P2 Words Info Suggest [GC | DOC] gated;
    "tw.gongwen.year" P2 Numbers Info Suggest [GC | DOC] gated;
    "tw.gongwen.markers" P2 Numbers Info Suggest [GC | DOC] gated;
    "tw.gongwen.tai" P2 Words Info Suggest [GC | DOC] gated;

    // English
    "en.word.misspelling" P0 Spelling Error Safe [GC | DOC];
    "en.punct.apostrophe-plural" P1 Punctuation Warning Suggest [GC | DOC];
    "en.punct.double-hyphen" P1 Punctuation Warning Suggest [GC | DOC];
    "en.word.article" P1 Words Warning Suggest [GC | DOC];
    "en.heading.end-punct" P1 Punctuation Warning Safe [GC | DOC];
    "en.spelling.variety" P1 Consistency Warning Suggest [GC | DOC];
    "en.link.text" P2 Words Info NoFix [DOC];
    "en.punct.serial-comma" P2 Consistency Info Suggest [DOC] gated;
    "en.punct.dash-style" P2 Consistency Info Suggest [DOC];
    "en.punct.quote-style" P2 Consistency Info Suggest [DOC];
    "en.num.sentence-start" P2 Numbers Info NoFix [GC | DOC];
    "en.num.clock" P2 Consistency Info NoFix [DOC];
    "en.word.etc" P2 Words Info Suggest [GC | DOC];
    "en.word.wordy" P2 Words Info Suggest [GC | DOC];
    "en.word.plain" P2 Words Info Suggest [GC | DOC] gated;
    "en.word.please" P2 Words Info NoFix [GC | DOC] gated;
    "en.word.inclusive" P2 Words Info Suggest [GC | DOC];
    "en.style.caps" P2 Style Info NoFix [GC | DOC];
    "en.style.sentence-length" P2 Style Info NoFix [DOC];
    "en.style.passive" P2 Style Info NoFix [GC | DOC];
    "en.style.ai-vocab" P2 Style Info NoFix [DOC];
    "en.num.minus" P2 Numbers Info Suggest [GC | DOC];
    "en.word.slash" P2 Words Info NoFix [GC | DOC];
    "en.govuk.style" P2 Words Info Suggest [GC | DOC] gated;

    // Japanese
    "ja.width.kana" P0 Characters Error Safe [GC | DOC | PR];
    "ja.punct.halfwidth" P0 Punctuation Error Safe [GC | DOC | CP | PR];
    "ja.width.alnum" P1 Characters Warning Safe [GC | DOC];
    "ja.space.typed" P1 Spacing Warning Safe [GC | DOC];
    "ja.space.fullwidth" P1 Spacing Warning Safe [GC | DOC];
    "ja.punct.after-exclaim" P2 Spacing Info Suggest [GC | DOC];
    "ja.punct.tilde" P1 Punctuation Warning Safe [GC | DOC];
    "ja.num.counter" P1 Numbers Warning Suggest [GC | DOC];
    "ja.punct.dots-dash" P1 Punctuation Warning Suggest [GC | DOC | CP];
    "ja.punct.single-leader" P2 Punctuation Info Suggest [GC | DOC];
    "ja.style.register-mix" P1 Consistency Warning NoFix [DOC];
    "ja.word.ranuki" P2 Words Info Suggest [GC | DOC];
    "ja.style.no-repeat" P2 Style Info NoFix [GC | DOC];
    "ja.style.double-negative" P2 Style Info NoFix [GC | DOC];
    "ja.word.redundant" P2 Words Info Suggest [GC | DOC];
    "ja.style.sentence-length" P2 Style Info NoFix [DOC];
    "ja.punct.period-bracket" P2 Punctuation Info Suggest [GC | DOC] gated;
    "ja.keigo.patterns" P2 Words Info NoFix [GC | DOC];
    "ja.word.choon" P2 Consistency Info Suggest [DOC];
    "ja.word.okurigana" P2 Consistency Info Suggest [DOC];
    "ja.num.kanji-digit" P1 Numbers Warning Suggest [GC | DOC];
    "ja.word.kodomo" P2 Consistency Info Suggest [DOC];

    // Korean
    "ko.space.particle" P0 Spacing Error Safe [GC | DOC | CP | PR];
    "ko.punct.cjk-marks" P0 Punctuation Error Safe [GC | DOC | PR];
    "ko.word.myeochil" P0 Spelling Error Safe [GC | DOC];
    "ko.word.dwae" P0 Spelling Error Safe [GC | DOC];
    "ko.word.saisiot" P1 Spelling Error Suggest [GC | DOC];
    "ko.word.ryul" P1 Spelling Error Suggest [GC | DOC];
    "ko.date.format" P1 Numbers Warning Suggest [GC | DOC];
    "ko.punct.colon-space" P1 Spacing Warning Safe [GC | DOC];
    "ko.word.double-passive" P2 Words Info NoFix [GC | DOC];
    "ko.honorific.thing" P2 Words Info NoFix [GC | DOC];
    "ko.style.register-mix" P2 Consistency Info NoFix [DOC];
    "ko.official.format" P1 Structure Warning Suggest [GC | DOC] gated;

    // Spanish
    "es.punct.inverted" P1 Punctuation Warning NoFix [GC | DOC];
    "es.punct.double-final" P1 Punctuation Warning Safe [GC | DOC];
    "es.quote.period-outside" P1 Punctuation Warning Suggest [GC | DOC];
    "es.word.monosyllable" P0 Spelling Error Safe [GC | DOC];
    "es.word.solo" P2 Spelling Info Suggest [GC | DOC] gated;
    "es.word.months" P1 Words Warning Suggest [GC | DOC];
    "es.punct.etc" P1 Punctuation Warning Safe [GC | DOC];
    "es.num.group" P2 Numbers Info Suggest [GC | DOC];
    "es.num.ordinal" P2 Numbers Info Suggest [GC | DOC];
    "es.num.percent" P2 Spacing Info Suggest [GC | DOC];
    "es.word.ex" P2 Words Info Suggest [GC | DOC];
    "es.num.word-unit" P2 Numbers Info NoFix [GC | DOC];
    "es.dialogue.raya" P1 Punctuation Warning Suggest [GC | DOC];

    // French
    "fr.space.high-punct" P1 Spacing Warning Suggest [GC | DOC | CP];
    "fr.num.ordinal" P1 Numbers Warning Suggest [GC | DOC];
    "fr.word.mr" P1 Words Warning Suggest [GC | DOC];
    "fr.word.euphonic-t" P0 Spelling Error Safe [GC | DOC];
    "fr.word.ligature" P1 Spelling Warning Suggest [GC | DOC];
    "fr.num.symbol-space" P2 Spacing Info Suggest [GC | DOC];
    "fr.punct.etc" P1 Punctuation Warning Safe [GC | DOC];
    "fr.word.capital-accent" P2 Spelling Info Suggest [GC | DOC];
    "fr.punct.apostrophe" P2 Consistency Info Suggest [DOC];
    "fr.dialogue.dash" P2 Consistency Info Suggest [DOC];

    // German
    "de.quote.style" P1 Punctuation Warning Suggest [GC | DOC];
    "de.quote.reporting-comma" P1 Punctuation Warning Suggest [GC | DOC];
    "de.punct.dash" P1 Punctuation Warning Suggest [GC | DOC];
    "de.word.abbr-space" P1 Spacing Warning Suggest [GC | DOC];
    "de.word.removed-variant" P1 Spelling Error Suggest [GC | DOC];
    "de.num.percent" P2 Spacing Info Suggest [GC | DOC];
    "de.comma.subordinate" P2 Punctuation Info Suggest [GC | DOC];
    "de.comma.adversative" P2 Punctuation Info Suggest [GC | DOC];
    "de.date.zero-pad" P2 Numbers Info Suggest [GC | DOC] gated;
    "de.num.group" P2 Numbers Info Suggest [GC | DOC];
    "de.word.eszett" P2 Spelling Info Suggest [GC | DOC];
    "de.word.gender-chars" P2 Words Info NoFix [GC | DOC] gated;

    // Russian
    "ru.quote.style" P1 Punctuation Warning Suggest [GC | DOC];
    "ru.quote.period-outside" P1 Punctuation Warning Suggest [GC | DOC];
    "ru.quote.exclaim-period" P2 Punctuation Info NoFix [GC | DOC];
    "ru.punct.dash" P1 Punctuation Warning Suggest [GC | DOC];
    "ru.punct.comma-dash" P1 Punctuation Warning Suggest [GC | DOC];
    "ru.word.abbr" P1 Spacing Warning Suggest [GC | DOC];
    "ru.num.ending" P1 Numbers Error Suggest [GC | DOC];
    "ru.num.unit" P1 Numbers Warning Suggest [GC | DOC];
    "ru.num.group" P2 Numbers Info Suggest [GC | DOC];
    "ru.num.percent" P2 Consistency Info Suggest [DOC];
    "ru.dialogue.dash" P1 Punctuation Warning Suggest [GC | DOC];

    // Portuguese
    "pt.quote.style" P1 Punctuation Warning Suggest [GC | DOC];
    "pt.spell.pre-ao90" P0 Spelling Error Safe [GC | DOC];
    "pt.spell.hyphen" P1 Spelling Warning Suggest [GC | DOC];
    "pt.num.ordinal" P1 Numbers Warning Suggest [GC | DOC];
    "pt.word.months" P1 Words Warning Suggest [GC | DOC];
    "pt.official.address" P2 Words Info NoFix [GC | DOC] gated;
    "pt.official.date" P2 Numbers Info Suggest [GC | DOC] gated;
    "pt.num.group" P2 Consistency Info Suggest [DOC];
}

pub fn info(id: &str) -> &'static RuleInfo {
    RULES
        .iter()
        .find(|r| r.id == id)
        .unwrap_or_else(|| panic!("rule {id} is not in the registry"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_unique_and_scoped() {
        for (i, r) in RULES.iter().enumerate() {
            assert!(
                RULES[i + 1..].iter().all(|o| o.id != r.id),
                "{} twice",
                r.id
            );
            let scope = r.id.split('.').next().unwrap();
            assert!(
                ["shared", "zh", "tw", "en", "ja", "ko", "es", "fr", "de", "ru", "pt"]
                    .contains(&scope),
                "{}",
                r.id
            );
            assert!(r.sites != 0, "{}", r.id);
            // Only P0 rules with safe fixes post-process proposals.
            if r.sites & PR != 0 && r.id != "shared.residue" {
                assert!(r.priority == Priority::P0 && r.fix == Fix::Safe, "{}", r.id);
            }
        }
    }
}
