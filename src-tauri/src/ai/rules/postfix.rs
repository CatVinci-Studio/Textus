//! The safe fixes applied without asking to completions and proposal text,
//! only where the document already follows the convention, so deliberate
//! half-width punctuation isn't fought.

use super::detect::{self, Lang};
use super::document::check_document_with;
use super::profile::Conventions;
use super::registry::{CP, PR};
use super::text::{is_cjk, Text};
use super::{apply, Finding, Fix, Level, Stats};

/// Proposal post-processing: the P0 "match the document" fixes, each only where
/// the rest of the document follows that convention. Returns the fixed text and
/// the rules applied.
pub fn proposal_text(
    document: &str,
    text: &str,
    conv: &Conventions,
) -> (String, Vec<&'static str>) {
    let doc_lang = detect::detect(document);
    let doc_report = check_document_with(document, None, conv, Level::Standard, &[]);
    let mut doc_stats = Stats::default();
    if let Some(lang) = doc_lang {
        doc_stats.count(&Text::new(document), lang);
    }
    let script_chars = |pred: fn(char) -> bool| document.chars().filter(|&c| pred(c)).count();
    let conforms = |rule: &str| -> bool {
        if doc_report.findings.iter().any(|f| f.rule == rule) {
            return false;
        }
        match rule {
            "shared.nfc" => true,
            r if r.starts_with("zh.") => {
                doc_lang.is_some_and(Lang::is_chinese)
                    && doc_stats.cjk_fw_punct >= 3
                    && script_chars(is_cjk) >= 20
            }
            "ja.punct.halfwidth" => {
                doc_lang == Some(Lang::Ja)
                    && doc_stats.ja_touten
                        + doc_stats.ja_kuten
                        + doc_stats.ja_comma
                        + doc_stats.ja_period
                        >= 3
            }
            r if r.starts_with("ja.") => doc_lang == Some(Lang::Ja),
            r if r.starts_with("ko.") => {
                doc_lang == Some(Lang::Ko) && script_chars(super::text::is_hangul) >= 20
            }
            _ => false,
        }
    };
    // French spacing the user chose, even where the document doesn't follow it
    // yet: models can't type a no-break space. Only the kind of space changes.
    let chosen_french = doc_lang == Some(Lang::Fr) && conv.profile_for(Lang::Fr).explicit;
    let french_space = |f: &Finding| -> bool {
        let unspaced = |s: &str| -> String { s.chars().filter(|c| !c.is_whitespace()).collect() };
        chosen_french
            && matches!(f.rule, "fr.space.high-punct" | "fr.num.symbol-space")
            && f.suggestion
                .as_deref()
                .is_some_and(|s| unspaced(s) == unspaced(&f.original))
    };
    let report = check_document_with(text, Some(document), conv, Level::Standard, &[]);
    let mut fixes: Vec<Finding> = report
        .findings
        .into_iter()
        .filter(|f| {
            f.info().sites & PR != 0
                && f.fix == Fix::Safe
                && f.suggestion.is_some()
                && conforms(f.rule)
        })
        .collect();
    if chosen_french {
        // Strict: the space before % is an Info-level rule.
        let strict = check_document_with(text, Some(document), conv, Level::Strict, &[]);
        fixes.extend(strict.findings.into_iter().filter(|f| french_space(f)));
        fixes.sort_by_key(|f| f.start);
    }
    let mut rules: Vec<&'static str> = fixes.iter().map(|f| f.rule).collect();
    rules.dedup();
    (apply(text, &fixes), rules)
}

/// [`proposal_text`] on a propose_edit call's JSON arguments: Some(new
/// arguments, rules applied) when its `text` changed.
pub fn proposal_arguments(
    arguments: &str,
    document: &str,
    conv: &Conventions,
) -> Option<(String, Vec<&'static str>)> {
    let mut value: serde_json::Value = serde_json::from_str(arguments).ok()?;
    let text = value.get("text")?.as_str()?.to_string();
    let (fixed, rules) = proposal_text(document, &text, conv);
    if fixed == text {
        return None;
    }
    value["text"] = serde_json::Value::String(fixed);
    Some((value.to_string(), rules))
}

/// The last `n` chars of `s`.
fn tail(s: &str, n: usize) -> &str {
    let count = s.chars().count();
    if count <= n {
        return s;
    }
    let skip = count - n;
    let at = s.char_indices().nth(skip).map_or(0, |(i, _)| i);
    &s[at..]
}

/// Completion post-processing, matched to the text before the cursor: NFC,
/// full-width CJK punctuation, CJK-Latin spacing, Korean particles, French
/// spacing, quote style. Never word changes, never a space in Japanese/Korean.
pub fn completion(before: &str, text: &str) -> String {
    if text.trim().is_empty() {
        return text.to_string();
    }
    let context = tail(before, 400);
    let lang = detect::guess(&format!("{context}{text}"));
    let mut b = Stats::default();
    if let Some(lang) = lang {
        b.count(&Text::new(context), lang);
    }
    let mut conv = Conventions::default();
    let mut allowed: Vec<&str> = vec!["shared.nfc"];
    match lang {
        Some(l) if l.is_chinese() => {
            if b.cjk_fw_punct >= 1 && b.cjk_hw_punct == 0 {
                allowed.push("zh.punct.halfwidth");
            }
            allowed.push("zh.punct.ellipsis");
            let mode = if b.cjk_latin_spaced >= 1 && b.cjk_latin_tight == 0 {
                Some("on")
            } else if b.cjk_latin_tight >= 1 && b.cjk_latin_spaced == 0 {
                Some("off")
            } else {
                None
            };
            if let Some(mode) = mode {
                conv.project
                    .options
                    .insert("cjk-latin-space".into(), mode.into());
                allowed.push("zh.space.cjk-latin");
            }
        }
        Some(Lang::Ja) => {
            if b.ja_touten + b.ja_kuten + b.ja_comma + b.ja_period >= 1 {
                allowed.push("ja.punct.halfwidth");
            }
            allowed.push("ja.punct.dots-dash");
        }
        Some(Lang::Ko) => allowed.push("ko.space.particle"),
        Some(Lang::Fr) => {
            let spaced = b.fr_space + b.fr_nbsp + b.fr_nnbsp;
            let spacing = if b.fr_none == 0 && spaced >= 1 {
                Some("fr-FR")
            } else if spaced == 0 && b.fr_none >= 1 {
                Some("fr-CA")
            } else {
                None
            };
            if let Some(s) = spacing {
                conv.project.options.insert("fr.spacing".into(), s.into());
                allowed.push("fr.space.high-punct");
            }
        }
        _ => {}
    }
    let combined = format!("{context}{text}");
    let k = context.chars().count();
    let found = super::check_as(&combined, lang, &conv, Level::Standard, &[], CP, None);
    let mut fixes: Vec<Finding> = Vec::new();
    for mut f in found {
        if !allowed.contains(&f.rule) || f.suggestion.is_none() {
            continue;
        }
        // A fix may reach back into the text before the cursor only by
        // characters it keeps (the CJK char before an added space).
        let mut original: Vec<char> = f.original.chars().collect();
        let mut suggestion: Vec<char> = f
            .suggestion
            .as_deref()
            .unwrap_or_default()
            .chars()
            .collect();
        while f.start < k
            && !original.is_empty()
            && !suggestion.is_empty()
            && original[0] == suggestion[0]
        {
            original.remove(0);
            suggestion.remove(0);
            f.start += 1;
        }
        if f.start < k {
            continue;
        }
        f.start -= k;
        f.end -= k;
        f.original = original.into_iter().collect();
        f.suggestion = Some(suggestion.into_iter().collect());
        fixes.push(f);
    }
    let fixed = apply(text, &fixes);
    match_quotes(context, &fixed)
}

/// Straight <-> curly double quotes and apostrophes in a completion, only
/// when the text before the cursor writes them one way throughout.
fn match_quotes(before: &str, text: &str) -> String {
    let count = |s: &str, cs: &[char]| s.chars().filter(|c| cs.contains(c)).count();
    let (straight, curly) = (count(before, &['"']), count(before, &['“', '”']));
    let mut out: Vec<char> = text.chars().collect();
    let prev_of = |out: &Vec<char>, i: usize| {
        if i == 0 {
            before.chars().last()
        } else {
            Some(out[i - 1])
        }
    };
    if curly >= 2 && straight == 0 {
        for i in 0..out.len() {
            if out[i] == '"' {
                let opening = prev_of(&out, i)
                    .is_none_or(|p| p.is_whitespace() || matches!(p, '(' | '[' | '—'));
                out[i] = if opening { '“' } else { '”' };
            }
        }
    } else if straight >= 2 && curly == 0 {
        for c in out.iter_mut() {
            if matches!(*c, '“' | '”') {
                *c = '"';
            }
        }
    }
    let (apos_s, apos_c) = (count(before, &['\'']), count(before, &['’']));
    for i in 0..out.len() {
        let between = prev_of(&out, i).is_some_and(char::is_alphabetic)
            && out.get(i + 1).is_some_and(|c| c.is_alphabetic());
        if !between {
            continue;
        }
        if out[i] == '\'' && apos_c >= 2 && apos_s == 0 {
            out[i] = '’';
        } else if out[i] == '’' && apos_s >= 2 && apos_c == 0 {
            out[i] = '\'';
        }
    }
    out.into_iter().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const ZH_DOC: &str = "# 周报\n\n本周我们完成了三项工作，进展顺利。下周继续推进，争取月底上线。团队讨论了预算问题，没有分歧。\n";

    #[test]
    fn proposals_match_a_document_that_follows_the_convention() {
        let conv = Conventions::default();
        let (fixed, rules) = proposal_text(ZH_DOC, "我们还需要测试,然后发布...", &conv);
        assert_eq!(fixed, "我们还需要测试，然后发布……");
        assert_eq!(rules, ["zh.punct.halfwidth", "zh.punct.ellipsis"]);
        // A document that writes half-width punctuation on purpose keeps it.
        let hw_doc = "本周我们完成了三项工作,进展顺利.下周继续推进,争取月底上线.团队讨论了预算问题,没有分歧.";
        let (fixed, rules) = proposal_text(hw_doc, "我们还需要测试,然后发布.", &conv);
        assert_eq!(fixed, "我们还需要测试,然后发布.");
        assert!(rules.is_empty());
        // Only P0 safe rules: a P1 suggestion (straight quotes) is not applied.
        let (fixed, _) = proposal_text(ZH_DOC, "他说\"好\"。", &conv);
        assert_eq!(fixed, "他说\"好\"。");
    }

    #[test]
    fn chosen_french_spacing_reaches_proposals() {
        let doc = "Bonjour! Le programme commence à neuf heures, avec l'accueil des participants et une présentation du projet.";
        let text = "Bonjour ! A-t-il confirmé sa venue ? La séance dure une heure ; voici le plan : 85 % viennent.";
        let mut conv = Conventions::default();
        // Automatic: French spacing isn't forced on a document without it.
        assert_eq!(proposal_text(doc, text, &conv).0, text);
        conv.project.profiles.push("fr-FR".into());
        let (fixed, rules) = proposal_text(doc, text, &conv);
        assert_eq!(
            fixed,
            "Bonjour\u{202f}! A-t-il confirmé sa venue\u{202f}? La séance dure une heure\u{202f}; voici le plan\u{a0}: 85\u{a0}% viennent."
        );
        assert_eq!(rules, ["fr.space.high-punct", "fr.num.symbol-space"]);
    }

    #[test]
    fn proposal_arguments_rewrite_only_text() {
        let conv = Conventions::default();
        let args = r#"{"action":"replace","anchor":"进展顺利。","text":"进展顺利,没有延期。"}"#;
        let (new_args, rules) = proposal_arguments(args, ZH_DOC, &conv).unwrap();
        let v: serde_json::Value = serde_json::from_str(&new_args).unwrap();
        assert_eq!(v["text"], "进展顺利，没有延期。");
        assert_eq!(v["anchor"], "进展顺利。");
        assert_eq!(rules, ["zh.punct.halfwidth"]);
        assert!(proposal_arguments(r#"{"action":"delete","anchor":"x"}"#, ZH_DOC, &conv).is_none());
        assert!(
            proposal_arguments(r#"{"action":"append","text":"没有问题。"}"#, ZH_DOC, &conv)
                .is_none()
        );
        // Korean and Japanese documents.
        let ko_doc = "이번 주에는 API를 정리하고 문서를 작성했습니다. 다음 주에는 테스트를 진행할 예정입니다.";
        assert_eq!(
            proposal_text(ko_doc, "v2 를 배포합니다。", &conv).0,
            "v2를 배포합니다."
        );
        let ja_doc = "今週は三つの作業を終えました。来週は試験を行い、月末に公開します。";
        assert_eq!(
            proposal_text(ja_doc, "ｶﾞｲﾄﾞを更新,公開します.", &conv).0,
            "ガイドを更新、公開します。"
        );
    }

    #[test]
    fn completions_match_the_text_before_the_cursor() {
        assert_eq!(
            completion("今天我们开会，讨论了预算。然后", "大家都同意,没有异议..."),
            "大家都同意，没有异议……"
        );
        // Half-width before the cursor: punctuation left alone.
        assert_eq!(
            completion("今天我们开会,讨论了预算.然后", "大家都同意,没有异议"),
            "大家都同意,没有异议"
        );
        // Spacing matched: spaced before, so the completion gets spaces -
        // including across the cursor.
        assert_eq!(completion("我们用 React 写了", "Vue组件"), " Vue 组件");
        assert_eq!(completion("我们用React写了", " Vue 组件"), "Vue组件");
        // Korean particles attach; Japanese never gets a space.
        assert_eq!(
            completion("이번 주에는 ", "API 를 정리했다"),
            "API를 정리했다"
        );
        assert_eq!(completion("新しい", "APIを使う"), "APIを使う");
        // French spacing matched.
        assert_eq!(
            completion("Vraiment\u{202F}? Oui\u{202F}! Et", " alors?"),
            " alors\u{202F}?"
        );
        // Quotes matched.
        assert_eq!(
            completion("He said “yes” and “no”, then", " \"maybe\" twice"),
            " “maybe” twice"
        );
        assert_eq!(
            completion("It's what they're", " doing’s fine"),
            " doing's fine"
        );
        // Nothing to do.
        assert_eq!(completion("Hello", " world"), " world");
    }
}
