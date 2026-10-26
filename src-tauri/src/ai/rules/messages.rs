//! Messages for the shared rules, which fire on text in any language, in the
//! UI languages: messages/<code>.txt, lines of `rule.key = message` with `{0}`
//! for values. English fills any gap.

use super::detect::Lang;
use std::collections::HashMap;
use std::sync::LazyLock;

macro_rules! message_files {
    ($($code:literal),*) => {
        const FILES: &[(&str, &str)] = &[$(($code, include_str!(concat!("messages/", $code, ".txt")))),*];
    };
}

message_files!("en", "zh", "zh-Hant", "ja", "ko", "es", "fr", "de", "ru", "pt");

static TABLES: LazyLock<HashMap<&'static str, HashMap<&'static str, &'static str>>> =
    LazyLock::new(|| {
        FILES
            .iter()
            .map(|(code, text)| {
                let table = text
                    .lines()
                    .map(str::trim)
                    .filter(|l| !l.is_empty() && !l.starts_with('#'))
                    .filter_map(|l| l.split_once(" = "))
                    .collect();
                (*code, table)
            })
            .collect()
    });

/// The message `key` in the language of `lang`'s text, values filled in.
pub(crate) fn get(key: &str, lang: Lang, values: &[&str]) -> String {
    let text = TABLES
        .get(lang.ui_code())
        .and_then(|t| t.get(key))
        .or_else(|| TABLES["en"].get(key))
        .copied()
        .unwrap_or(key);
    let mut out = text.to_string();
    for (i, v) in values.iter().enumerate() {
        out = out.replace(&format!("{{{i}}}"), v);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_language_has_every_message_with_the_same_placeholders() {
        let en = &TABLES["en"];
        assert!(en.len() >= 10);
        for (code, table) in TABLES.iter() {
            for (key, text) in en {
                let theirs = table
                    .get(key)
                    .unwrap_or_else(|| panic!("{code}: missing {key}"));
                for i in 0..3 {
                    let ph = format!("{{{i}}}");
                    assert_eq!(text.contains(&ph), theirs.contains(&ph), "{code}: {key}");
                }
            }
            for key in table.keys() {
                assert!(en.contains_key(key), "{code}: {key} is not in en.txt");
            }
        }
        assert_eq!(TABLES.len(), 10);
        // Every UI language has a file.
        for lang in crate::ai::ui_language::UI_LANGUAGES {
            assert!(TABLES.contains_key(lang.code), "{}", lang.code);
        }
        assert_eq!(
            get("shared.library-name", Lang::En, &["Elizabeth"]),
            "Possible misspelling of the library name “Elizabeth”."
        );
    }
}
