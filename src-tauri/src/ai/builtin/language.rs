//! Which language a document is in, and which one a request asks to
//! translate into - what picks a pack's language.

use super::*;

/// Where the document's language came from.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum LanguageSource {
    /// Read from the document's own text.
    Detected,
    /// The document has too little text to tell; the app's UI language.
    UiLanguage,
}

/// The pack language for this document: read from its text, else the UI
/// language's, else none.
pub(crate) fn document_language(
    document: &str,
    ui_language: &str,
) -> Option<(&'static str, LanguageSource)> {
    if let Some(code) = detect(document) {
        return Some((code, LanguageSource::Detected));
    }
    PACK_LANGUAGES
        .iter()
        .find(|(_, _, ui)| *ui == ui_language)
        .map(|(code, _, _)| (*code, LanguageSource::UiLanguage))
}

/// Best guess at a document's pack language, from its prose (code, URLs
/// and Markdown markup left out); None when there is too little to tell.
/// The rules engine's detector (rules::detect), as a pack code.
pub(crate) fn detect(text: &str) -> Option<&'static str> {
    use crate::ai::rules::Lang;
    Some(match crate::ai::rules::detect::detect(text)? {
        Lang::ZhHans => "zh-hans",
        Lang::ZhHant => "zh-hant",
        Lang::En => "en",
        Lang::Ja => "ja",
        Lang::Ko => "ko",
        Lang::Es => "es",
        Lang::Fr => "fr",
        Lang::De => "de",
        Lang::Ru => "ru",
        Lang::Pt => "pt",
    })
}

/// Names of the pack languages in the ten UI languages, lowercase, for
/// finding a translation's target in a request. Latin and Cyrillic entries
/// match at a word start, so inflected forms (Englische, английского)
/// count; CJK ones anywhere.
pub(crate) const LANGUAGE_NAMES: &[(&str, &[&str])] = &[
    (
        "en",
        &[
            "english", "英语", "英文", "英語", "영어", "inglés", "ingles", "anglais", "englisch",
            "англ", "inglês",
        ],
    ),
    (
        "zh-hans",
        &[
            "simplified chinese",
            "chinese",
            "mandarin",
            "中文",
            "汉语",
            "汉文",
            "简体",
            "簡體",
            "中国語",
            "중국어",
            "chino",
            "chinois",
            "chinesisch",
            "китайск",
            "chinês",
        ],
    ),
    (
        "zh-hant",
        &[
            "traditional chinese",
            "繁体",
            "繁體",
            "正體",
            "台湾",
            "台灣",
            "臺灣",
            "번체",
            "chino tradicional",
            "chinois traditionnel",
            "traditionelles chinesisch",
            "traditionellem chinesisch",
            "традиционный китайский",
            "chinês tradicional",
        ],
    ),
    (
        "ja",
        &[
            "japanese",
            "日语",
            "日文",
            "日語",
            "日本語",
            "일본어",
            "japonés",
            "japones",
            "japonais",
            "japanisch",
            "японск",
            "japonês",
        ],
    ),
    (
        "ko",
        &[
            "korean",
            "韩语",
            "韩文",
            "韓語",
            "韓文",
            "韓国語",
            "한국어",
            "coreano",
            "coréen",
            "koreanisch",
            "корейск",
        ],
    ),
    (
        "es",
        &[
            "spanish",
            "西班牙语",
            "西班牙文",
            "西班牙語",
            "スペイン語",
            "스페인어",
            "español",
            "castellano",
            "espagnol",
            "spanisch",
            "испанск",
            "espanhol",
        ],
    ),
    (
        "fr",
        &[
            "french",
            "法语",
            "法文",
            "法語",
            "フランス語",
            "프랑스어",
            "francés",
            "frances",
            "français",
            "französisch",
            "французск",
            "francês",
        ],
    ),
    (
        "de",
        &[
            "german",
            "德语",
            "德文",
            "德語",
            "ドイツ語",
            "독일어",
            "alemán",
            "aleman",
            "allemand",
            "deutsch",
            "немецк",
            "alemão",
        ],
    ),
    (
        "ru",
        &[
            "russian",
            "俄语",
            "俄文",
            "俄語",
            "ロシア語",
            "러시아어",
            "ruso",
            "russe",
            "russisch",
            "русск",
            "russo",
        ],
    ),
    (
        "pt",
        &[
            "portuguese",
            "葡萄牙语",
            "葡萄牙文",
            "葡萄牙語",
            "ポルトガル語",
            "포르투갈어",
            "portugués",
            "portugais",
            "portugiesisch",
            "португальск",
            "português",
            "portugues",
        ],
    ),
];

/// Words that come just before a translation's target ("into", "成", "に",
/// "로", "al", "en", "auf", "на"…), to pick the target when a request
/// names two languages ("translate this Chinese text into English").
pub(crate) const TARGET_MARKERS: &[&str] = &[
    "into ", "to ", "成", "为", "為", "到", "に", "로 ", "으로 ", "al ", "a ", "en ", "auf ",
    "ins ", "на ", "para ", "em ", "para o ", "vers ", "in ",
];

/// The pack language a translation request asks for, when it names one -
/// or, naming several, marks one as the target.
pub(crate) fn target_language(request: &str) -> Option<&'static str> {
    let lower = request.to_lowercase();
    // (start, end, code) of every name found.
    let mut found: Vec<(usize, usize, &'static str)> = Vec::new();
    for (code, names) in LANGUAGE_NAMES {
        for name in *names {
            let latin = name
                .chars()
                .next()
                .is_some_and(|c| c.is_alphabetic() && (c as u32) < 0x2e80);
            for (at, _) in lower.match_indices(name) {
                let word_start = !latin
                    || lower[..at]
                        .chars()
                        .next_back()
                        .is_none_or(|c| !c.is_alphanumeric());
                if word_start {
                    found.push((at, at + name.len(), code));
                }
            }
        }
    }
    // A name inside a longer one ("chinese" in "traditional chinese",
    // "中文" in "繁體中文" is not, but "繁體" is first) loses to it.
    let all = found.clone();
    found.retain(|&(s, e, _)| {
        !all.iter()
            .any(|&(s2, e2, _)| s2 <= s && e <= e2 && (e2 - s2) > (e - s))
    });
    // "繁體中文" names 繁體 and 中文 side by side: one name.
    found.sort();
    let mut merged: Vec<(usize, usize, &'static str)> = Vec::new();
    for item in found {
        match merged.last_mut() {
            Some(last) if item.0 <= last.1 && last.2 == "zh-hant" && item.2 == "zh-hans" => {
                last.1 = last.1.max(item.1)
            }
            Some(last) if item.0 <= last.1 && last.2 == "zh-hans" && item.2 == "zh-hant" => {
                *last = (last.0, last.1.max(item.1), "zh-hant")
            }
            _ => merged.push(item),
        }
    }
    let mut codes: Vec<&str> = merged.iter().map(|m| m.2).collect();
    codes.dedup();
    match codes.as_slice() {
        [] => None,
        [one] => Some(one),
        _ => {
            let marked: Vec<&str> = merged
                .iter()
                .filter(|(s, _, _)| TARGET_MARKERS.iter().any(|m| lower[..*s].ends_with(m)))
                .map(|m| m.2)
                .collect();
            match marked.as_slice() {
                [one, ..] if marked.iter().all(|c| c == one) => Some(one),
                _ => None,
            }
        }
    }
}
