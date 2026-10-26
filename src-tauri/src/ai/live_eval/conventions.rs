//! The live eval's `conventions_clean` check: the rules engine run over the
//! text an edit wrote, at the standard level, counting every finding but info.
//! Without an engine the check's name says it measured nothing.

use super::checks;

/// How sure a rule is that something is wrong (catalogue §3.0).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Severity {
    Error,
    Warning,
    Info,
}

/// Whether a finding's suggestion may be applied without asking. (Fields the
/// check doesn't read mirror the engine's shape.)
#[allow(dead_code)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Fix {
    Safe,
    Suggest,
    None,
}

/// One rule hit, as the engine reports it.
#[allow(dead_code)]
#[derive(Clone, Debug)]
pub struct Finding {
    pub rule: String,
    /// Unicode-scalar offsets into the checked text.
    pub start: usize,
    pub end: usize,
    pub original: String,
    pub suggestion: Option<String>,
    pub severity: Severity,
    pub fix: Fix,
    pub message: String,
}

/// The grammar check's strictness: which rule priorities run.
#[allow(dead_code)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Level {
    /// Spelling rules only.
    Typos,
    /// P0 and P1.
    Standard,
    /// Everything, P2 included.
    Strict,
}

/// The rules engine as the check calls it: one paragraph of plain text, its
/// language, the conventions profile (`zh-Hans-CN/fiction`...) and the level.
pub trait Engine: Sync {
    fn check(&self, text: &str, lang: &str, profile: &str, level: Level) -> Vec<Finding>;
}

/// The real rules engine: the paragraph checked in the case's language, under
/// exactly its profile, with no library names.
struct RulesEngine;

impl Engine for RulesEngine {
    fn check(&self, text: &str, lang: &str, profile: &str, level: Level) -> Vec<Finding> {
        use crate::ai::rules;
        let conv = rules::Conventions {
            setting: Some(serde_json::Value::String(profile.to_string())),
            project: rules::ProjectConventions::default(),
        };
        let level = match level {
            Level::Typos => rules::Level::Typos,
            Level::Standard => rules::Level::Standard,
            Level::Strict => rules::Level::Strict,
        };
        let lang = rules::Lang::from_code(lang).or_else(|| rules::detect::guess(text));
        rules::check_as(text, lang, &conv, level, &[], rules::registry::GC, None)
            .into_iter()
            .map(|f| Finding {
                rule: f.rule.to_string(),
                start: f.start,
                end: f.end,
                original: f.original,
                suggestion: f.suggestion,
                severity: match f.severity {
                    rules::Severity::Error => Severity::Error,
                    rules::Severity::Warning => Severity::Warning,
                    rules::Severity::Info => Severity::Info,
                },
                fix: match f.fix {
                    rules::Fix::Safe => Fix::Safe,
                    rules::Fix::Suggest => Fix::Suggest,
                    rules::Fix::None => Fix::None,
                },
                message: f.message,
            })
            .collect()
    }
}

/// The rules engine the check runs.
pub fn engine() -> Option<&'static dyn Engine> {
    Some(&RulesEngine)
}

/// The language code the engine takes, from a conventions profile
/// (`zh-Hant-TW/gongwen` -> `zh-Hant`, `fr-CA` -> `fr`). A bare `zh` is
/// Simplified.
pub fn profile_lang(profile: &str) -> String {
    let tag = profile.split('/').next().unwrap_or("").trim();
    let mut parts = tag.split('-');
    let base = parts.next().unwrap_or("").to_ascii_lowercase();
    if base == "zh" {
        let script = parts
            .find(|p| p.eq_ignore_ascii_case("hant") || p.eq_ignore_ascii_case("hans"))
            .map(|p| p.to_ascii_lowercase());
        return if script.as_deref() == Some("hant") {
            "zh-Hant".into()
        } else {
            "zh-Hans".into()
        };
    }
    base
}

/// The whole blocks of `after` that an edit from `before` touched, so the
/// rules see complete paragraphs. Empty when nothing changed.
pub fn changed_blocks(before: &str, after: &str) -> String {
    super::checks_builtin::changed_blocks(before, after).1
}

/// The prose paragraphs of a Markdown passage as plain text, leaving out what
/// the engine never checks: code, display math, front matter, tables, HTML.
pub fn prose_paragraphs(markdown: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut in_fence = false;
    let mut in_math = false;
    let mut in_front_matter = markdown.starts_with("---\n");
    let mut block = String::new();
    let mut flush = |block: &mut String| {
        let text = checks::plain_text(block, "\n");
        if text.trim().chars().any(char::is_alphanumeric) {
            out.push(text.trim().to_string());
        }
        block.clear();
    };
    for (i, line) in markdown.lines().enumerate() {
        let t = line.trim_start();
        if in_front_matter {
            if i > 0 && t == "---" {
                in_front_matter = false;
            }
            continue;
        }
        if t.starts_with("```") || t.starts_with("~~~") {
            flush(&mut block);
            in_fence = !in_fence;
            continue;
        }
        if t.starts_with("$$") {
            flush(&mut block);
            in_math = !(in_math || t.len() > 2 && t.ends_with("$$"));
            continue;
        }
        if in_fence || in_math || t.starts_with('|') || t.starts_with('<') {
            continue;
        }
        if t.is_empty() {
            flush(&mut block);
        } else {
            block.push_str(line);
            block.push('\n');
        }
    }
    flush(&mut block);
    out
}

/// Ok when the engine finds nothing at `level` (info aside) in any prose
/// paragraph of `markdown`; otherwise the findings, a few per message.
pub fn clean_with(
    engine: &dyn Engine,
    markdown: &str,
    profile: &str,
    level: Level,
) -> Result<(), String> {
    let lang = profile_lang(profile);
    let mut problems = Vec::new();
    for para in prose_paragraphs(markdown) {
        for f in engine.check(&para, &lang, profile, level) {
            if f.severity == Severity::Info {
                continue;
            }
            problems.push(match &f.suggestion {
                Some(s) => format!("{}: {:?} -> {:?}", f.rule, f.original, s),
                None => format!("{}: {:?}", f.rule, f.original),
            });
        }
    }
    if problems.is_empty() {
        return Ok(());
    }
    let shown = problems.len().min(8);
    let more = problems.len() - shown;
    Err(format!(
        "{} finding(s): {}{}",
        problems.len(),
        problems[..shown].join("; "),
        if more > 0 {
            format!("; and {more} more")
        } else {
            String::new()
        }
    ))
}

/// The check's name in the record: it says when there was no engine to
/// ask, so a pass without one is never mistaken for a clean result.
pub fn check_name(profile: &str, have_engine: bool) -> String {
    if have_engine {
        format!("conventions clean ({profile})")
    } else {
        format!("conventions clean ({profile}): not checked (no rules engine)")
    }
}

/// `conventions_clean(profile, level)` on an edit: the paragraphs it
/// touched, checked by the engine; Ok when there's no engine or no edit.
pub fn clean_edit(before: &str, after: &str, profile: &str, level: Level) -> Result<(), String> {
    match engine() {
        Some(engine) => clean_with(engine, &changed_blocks(before, after), profile, level),
        None => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    /// Flags ASCII commas and an "alot" (as an error), and every "Note"
    /// (as info); remembers what it was asked.
    struct Fake {
        calls: Mutex<Vec<(String, String, String, Level)>>,
    }

    impl Engine for Fake {
        fn check(&self, text: &str, lang: &str, profile: &str, level: Level) -> Vec<Finding> {
            self.calls
                .lock()
                .unwrap()
                .push((text.into(), lang.into(), profile.into(), level));
            let mut out = Vec::new();
            for (i, c) in text.chars().enumerate() {
                if c == ',' && lang.starts_with("zh") {
                    out.push(finding("zh.fullwidth", i, ",", Some("，"), Severity::Error));
                }
            }
            if let Some(i) = text.find("alot") {
                out.push(finding(
                    "en.alot",
                    i,
                    "alot",
                    Some("a lot"),
                    Severity::Warning,
                ));
            }
            if text.contains("Note") {
                out.push(finding(
                    "shared.consistency",
                    0,
                    "Note",
                    None,
                    Severity::Info,
                ));
            }
            out
        }
    }

    fn finding(
        rule: &str,
        start: usize,
        original: &str,
        suggestion: Option<&str>,
        severity: Severity,
    ) -> Finding {
        Finding {
            rule: rule.into(),
            start,
            end: start + original.chars().count(),
            original: original.into(),
            suggestion: suggestion.map(str::to_string),
            severity,
            fix: Fix::Suggest,
            message: String::new(),
        }
    }

    fn fake() -> Fake {
        Fake {
            calls: Mutex::new(Vec::new()),
        }
    }

    #[test]
    fn profiles_name_the_engine_language() {
        assert_eq!(profile_lang("zh-Hans-CN/fiction"), "zh-Hans");
        assert_eq!(profile_lang("zh-Hant-TW/gongwen"), "zh-Hant");
        assert_eq!(profile_lang("zh"), "zh-Hans");
        assert_eq!(profile_lang("en-US/general"), "en");
        assert_eq!(profile_lang("en-GB/govuk"), "en");
        assert_eq!(profile_lang("fr-CA"), "fr");
        assert_eq!(profile_lang("de-DE"), "de");
        assert_eq!(profile_lang("pt-BR/official"), "pt");
        assert_eq!(profile_lang("ja"), "ja");
    }

    #[test]
    fn only_the_touched_paragraphs_are_checked() {
        let before = "# T\n\nFirst, untouched.\n\nSecond one.\n\nThird.";
        let after = "# T\n\nFirst, untouched.\n\nSecond one, longer now.\n\nThird.";
        assert_eq!(changed_blocks(before, after), "Second one, longer now.");
        // An inserted paragraph is its own block.
        let after = "# T\n\nFirst, untouched.\n\nNew.\n\nSecond one.\n\nThird.";
        assert_eq!(changed_blocks(before, after), "New.");
        assert_eq!(changed_blocks(before, before), "");
        // A change at the very start or end reaches the document's edge.
        assert_eq!(changed_blocks("a\n\nb", "a\n\nbc"), "bc");
        assert_eq!(changed_blocks("a\n\nb", "xa\n\nb"), "xa");
    }

    #[test]
    fn code_math_tables_and_front_matter_are_not_prose() {
        let md = "---\ntitle: a, b\n---\n\n# Heading, here\n\nText with `code, x` and **bold**.\n\n```\nlet a, b;\n```\n\n$$\nx, y\n$$\n\n| a, b |\n| --- |\n\n<div>a, b</div>\n\n* item, one";
        let paras = prose_paragraphs(md);
        assert_eq!(
            paras,
            vec!["Heading, here", "Text with code, x and bold.", "item, one"],
            "{paras:?}"
        );
    }

    #[test]
    fn clean_counts_errors_and_warnings_not_info() {
        let engine = fake();
        assert!(clean_with(
            &engine,
            "林晚说，好。",
            "zh-Hans-CN/fiction",
            Level::Standard
        )
        .is_ok());
        let err = clean_with(
            &engine,
            "林晚说,好。",
            "zh-Hans-CN/fiction",
            Level::Standard,
        )
        .unwrap_err();
        assert!(err.contains("zh.fullwidth"), "{err}");
        assert!(err.starts_with("1 finding"), "{err}");
        // Info alone passes; a warning fails.
        assert!(clean_with(&engine, "Note this.", "en-US/general", Level::Standard).is_ok());
        assert!(clean_with(&engine, "Note alot.", "en-US/general", Level::Standard).is_err());
        let calls = engine.calls.lock().unwrap();
        assert_eq!(
            calls[0],
            (
                "林晚说，好。".to_string(),
                "zh-Hans".to_string(),
                "zh-Hans-CN/fiction".to_string(),
                Level::Standard
            )
        );
    }

    #[test]
    fn long_reports_are_cut_and_counted() {
        let engine = fake();
        let text = ",".repeat(12);
        let err =
            clean_with(&engine, &format!("字{text}"), "zh-Hans-CN", Level::Standard).unwrap_err();
        assert!(err.starts_with("12 finding"), "{err}");
        assert!(err.ends_with("and 4 more"), "{err}");
    }

    #[test]
    fn without_an_engine_the_check_says_so() {
        assert!(check_name("fr-FR", false).contains("not checked"));
        assert_eq!(check_name("fr-FR", true), "conventions clean (fr-FR)");
        if engine().is_none() {
            assert!(clean_edit("a", "b,", "zh-Hans-CN", Level::Standard).is_ok());
        }
    }

    #[test]
    fn the_real_engine_is_wired_in() {
        assert!(engine().is_some());
        let before = "# 周报\n\n本周完成了三项工作。";
        let clean = "# 周报\n\n本周完成了三项工作，进展顺利。";
        assert!(clean_edit(before, clean, "zh-Hans-CN", Level::Standard).is_ok());
        let err = clean_edit(
            before,
            "# 周报\n\n本周完成了三项工作,进展顺利。",
            "zh-Hans-CN",
            Level::Standard,
        )
        .unwrap_err();
        assert!(err.contains("zh.punct.halfwidth"), "{err}");
        // Each profile the suite uses reaches the engine as a valid choice.
        for profile in [
            "zh-Hans-CN/fiction",
            "zh-Hans-CN",
            "zh-Hant-TW/gongwen",
            "en-US/general",
            "de-DE",
            "fr-FR",
            "ko",
        ] {
            assert!(
                crate::ai::rules::Profile::parse(profile).is_some(),
                "{profile}"
            );
        }
    }
}
