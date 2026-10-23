//! Which language a paragraph or document is in - script ratios for the
//! scripts that tell themselves apart, the Simplified/Traditional pair
//! table for Chinese, and frequent-word lists for the Latin-script
//! languages. Promoted from the live eval's checks (which now call this),
//! so the rules engine and the eval agree on what a text "is".

use serde::Serialize;

/// The ten document languages the rules engine knows.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, PartialOrd, Ord)]
#[cfg_attr(test, derive(specta::Type))]
pub enum Lang {
    #[serde(rename = "en")]
    En,
    #[serde(rename = "zh-Hans")]
    ZhHans,
    #[serde(rename = "zh-Hant")]
    ZhHant,
    #[serde(rename = "ja")]
    Ja,
    #[serde(rename = "ko")]
    Ko,
    #[serde(rename = "es")]
    Es,
    #[serde(rename = "fr")]
    Fr,
    #[serde(rename = "de")]
    De,
    #[serde(rename = "ru")]
    Ru,
    #[serde(rename = "pt")]
    Pt,
}

impl Lang {
    pub const ALL: [Lang; 10] = [
        Lang::ZhHans,
        Lang::ZhHant,
        Lang::En,
        Lang::Ja,
        Lang::Ko,
        Lang::Es,
        Lang::Fr,
        Lang::De,
        Lang::Ru,
        Lang::Pt,
    ];

    /// The language key used by profiles and settings (`zh-Hans`, `en`...).
    pub fn code(self) -> &'static str {
        match self {
            Lang::En => "en",
            Lang::ZhHans => "zh-Hans",
            Lang::ZhHant => "zh-Hant",
            Lang::Ja => "ja",
            Lang::Ko => "ko",
            Lang::Es => "es",
            Lang::Fr => "fr",
            Lang::De => "de",
            Lang::Ru => "ru",
            Lang::Pt => "pt",
        }
    }

    pub fn from_code(code: &str) -> Option<Lang> {
        Lang::ALL
            .into_iter()
            .find(|l| l.code().eq_ignore_ascii_case(code))
    }

    /// The UI language whose words a message in this language uses
    /// (src/i18n/langs.ts: "zh" is Simplified Chinese there).
    pub fn ui_code(self) -> &'static str {
        match self {
            Lang::ZhHans => "zh",
            other => other.code(),
        }
    }

    pub fn is_chinese(self) -> bool {
        matches!(self, Lang::ZhHans | Lang::ZhHant)
    }
}

/// [`detect`], or - for a text too short to tell, such as a five-character
/// Chinese clause - a guess from the scripts alone: kana is Japanese,
/// Hangul Korean, ideographs Chinese, Cyrillic Russian. Latin-script text
/// that short stays unknown: its languages share an alphabet.
pub fn guess(text: &str) -> Option<Lang> {
    if let Some(lang) = detect(text) {
        return Some(lang);
    }
    let c = script_counts(text);
    if c.kana > 0 {
        Some(Lang::Ja)
    } else if c.hangul > 0 && c.hangul >= c.han {
        Some(Lang::Ko)
    } else if c.han > 0 {
        Some(chinese_script(text))
    } else if c.cyrillic > c.latin {
        Some(Lang::Ru)
    } else {
        None
    }
}

/// Simplified or Traditional, by the characters only one script has;
/// Simplified when nothing tells.
pub fn chinese_script(text: &str) -> Lang {
    let (mut hans, mut hant) = (0, 0);
    for ch in text.chars() {
        if HANS_HANT.iter().any(|&(s, _)| s == ch) {
            hans += 1;
        }
        if HANS_HANT.iter().any(|&(_, t)| t == ch) {
            hant += 1;
        }
    }
    if hant > hans {
        Lang::ZhHant
    } else {
        Lang::ZhHans
    }
}

/// Characters that exist in only one of the two Chinese scripts, in pairs
/// (simplified, traditional) - common enough that any real paragraph has a
/// few. Used to tell zh-Hans from zh-Hant, which script ratios can't.
pub(crate) const HANS_HANT: &[(char, char)] = &[
    ('们', '們'),
    ('这', '這'),
    ('个', '個'),
    ('说', '說'),
    ('为', '為'),
    ('学', '學'),
    ('国', '國'),
    ('时', '時'),
    ('会', '會'),
    ('来', '來'),
    ('对', '對'),
    ('发', '發'),
    ('经', '經'),
    ('过', '過'),
    ('还', '還'),
    ('见', '見'),
    ('长', '長'),
    ('门', '門'),
    ('问', '問'),
    ('开', '開'),
    ('关', '關'),
    ('买', '買'),
    ('东', '東'),
    ('车', '車'),
    ('电', '電'),
    ('话', '話'),
    ('体', '體'),
    ('点', '點'),
    ('变', '變'),
    ('让', '讓'),
    ('从', '從'),
    ('后', '後'),
    ('里', '裡'),
    ('与', '與'),
    ('实', '實'),
    ('现', '現'),
    ('观', '觀'),
    ('应', '應'),
    ('该', '該'),
    ('样', '樣'),
    ('间', '間'),
    ('题', '題'),
    ('结', '結'),
    ('论', '論'),
    ('议', '議'),
    ('认', '認'),
    ('识', '識'),
    ('历', '歷'),
    ('区', '區'),
    ('页', '頁'),
    ('写', '寫'),
    ('读', '讀'),
    ('书', '書'),
    ('图', '圖'),
    ('数', '數'),
    ('据', '據'),
    ('计', '計'),
    ('划', '劃'),
    ('试', '試'),
    ('验', '驗'),
    ('价', '價'),
    ('钱', '錢'),
    ('业', '業'),
    ('产', '產'),
    ('统', '統'),
    ('级', '級'),
    ('网', '網'),
    ('络', '絡'),
    ('报', '報'),
    ('告', '告'),
];

/// Word lists for telling the Latin-script languages apart, weighted
/// towards words that are frequent in one language and rare in the others.
const LATIN_WORDS: &[(Lang, &[&str])] = &[
    (
        Lang::En,
        &[
            "the", "and", "of", "to", "is", "that", "it", "with", "for", "this", "are", "was",
            "be", "on", "not", "you", "have", "we", "they", "which", "will", "from", "but",
        ],
    ),
    (
        Lang::Es,
        &[
            "el", "los", "las", "y", "del", "una", "es", "con", "se", "más", "pero", "muy", "pues",
            "aquí", "también", "está", "están", "sus", "hay", "fue", "este", "la", "lo", "por",
            "su", "al", "como",
        ],
    ),
    (
        Lang::Fr,
        &[
            "le", "les", "des", "et", "est", "une", "pour", "dans", "pas", "sur", "du", "avec",
            "au", "ce", "qui", "nous", "vous", "sont", "mais", "plus", "être", "cette", "aux",
            "la", "je", "tu", "il", "elle", "avant", "très", "sans",
        ],
    ),
    (
        Lang::De,
        &[
            "der", "die", "das", "und", "ist", "nicht", "ein", "eine", "zu", "mit", "den", "von",
            "auf", "für", "sich", "dem", "auch", "wir", "es", "sind", "wird", "werden",
        ],
    ),
    (
        Lang::Pt,
        &[
            "os", "do", "da", "em", "um", "uma", "não", "é", "com", "dos", "das", "mais", "mas",
            "como", "também", "são", "está", "foi", "pelo", "pela", "nos", "ao", "seu", "e", "ali",
            "depois", "isso", "muito", "ainda", "o", "na", "você", "pra", "seus", "suas",
        ],
    ),
];

#[derive(Default, Debug)]
struct ScriptCounts {
    han: usize,
    kana: usize,
    hangul: usize,
    cyrillic: usize,
    latin: usize,
}

fn script_counts(text: &str) -> ScriptCounts {
    let mut c = ScriptCounts::default();
    for ch in text.chars() {
        match ch {
            '\u{4e00}'..='\u{9fff}' | '\u{3400}'..='\u{4dbf}' => c.han += 1,
            '\u{3040}'..='\u{30ff}' => c.kana += 1,
            '\u{ac00}'..='\u{d7af}' | '\u{1100}'..='\u{11ff}' => c.hangul += 1,
            '\u{0400}'..='\u{04ff}' => c.cyrillic += 1,
            c2 if c2.is_alphabetic()
                && (c2.is_ascii() || ('\u{00c0}'..='\u{024f}').contains(&c2)) =>
            {
                c.latin += 1
            }
            _ => {}
        }
    }
    c
}

/// Prose only: code spans and fences, URLs, and Markdown punctuation say
/// nothing about the language and would skew every ratio towards Latin.
fn prose_only(text: &str) -> String {
    let mut out = String::new();
    let mut in_fence = false;
    for line in text.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence {
            continue;
        }
        let mut in_code = false;
        for (i, part) in line.split('`').enumerate() {
            if i > 0 {
                in_code = !in_code;
            }
            if !in_code {
                for word in part.split_whitespace() {
                    if !word.contains("://") && !word.starts_with("$") {
                        out.push_str(word);
                        out.push(' ');
                    }
                }
            }
        }
        out.push('\n');
    }
    out
}

/// Best guess at the language of `text`, or None when there is too little
/// prose to tell (a number, a single name).
pub fn detect(text: &str) -> Option<Lang> {
    let prose = prose_only(text);
    let c = script_counts(&prose);
    let cjk = c.han + c.kana;
    let total = cjk + c.hangul + c.cyrillic + c.latin;
    if total < 6 {
        return None;
    }
    if c.hangul * 3 > total {
        return Some(Lang::Ko);
    }
    // Japanese mixes kanji with kana; even kanji-heavy prose has particles.
    if c.kana >= 3 && c.kana * 8 > cjk {
        return Some(Lang::Ja);
    }
    // CJK characters carry roughly a word each, Latin letters a fifth of
    // one - so Chinese with English terms still counts as Chinese.
    if cjk * 5 >= c.latin && cjk >= 4 {
        let (mut hans, mut hant) = (0, 0);
        for ch in prose.chars() {
            if HANS_HANT.iter().any(|&(s, _)| s == ch) {
                hans += 1;
            }
            if HANS_HANT.iter().any(|&(_, t)| t == ch) {
                hant += 1;
            }
        }
        return Some(if hant > hans {
            Lang::ZhHant
        } else {
            Lang::ZhHans
        });
    }
    if c.cyrillic > c.latin {
        return Some(Lang::Ru);
    }
    let lower = prose.to_lowercase();
    let words: Vec<&str> = lower
        .split(|ch: char| !ch.is_alphabetic())
        .filter(|w| !w.is_empty())
        .collect();
    // No evidence, or a tie between languages: too little to tell. Short
    // completions ("alojamiento", " buchen", "tu me promets de revenir")
    // used to default to English, or to whichever list came first.
    let mut best = (Lang::En, 0.0f64);
    let mut tied = false;
    for (lang, list) in LATIN_WORDS {
        let mut score = words.iter().filter(|w| list.contains(w)).count() as f64;
        // Letters only one of these languages uses.
        score += match lang {
            Lang::Es => lower.matches(['ñ', '¿', '¡']).count() as f64 * 2.0,
            Lang::Pt => {
                lower.matches(['ã', 'õ']).count() as f64 * 2.0
                    + lower.matches("ção").count() as f64
                    // Digraphs Spanish doesn't have.
                    + (lower.matches("lh").count() + lower.matches("nh").count()) as f64
            }
            Lang::De => lower.matches(['ß', 'ä', 'ö', 'ü']).count() as f64 * 1.5,
            Lang::Fr => lower.matches(['è', 'ê', 'à', 'œ', 'ù', 'û']).count() as f64 * 1.5,
            _ => 0.0,
        };
        if score > best.1 {
            best = (*lang, score);
            tied = false;
        } else if score > 0.0 && score == best.1 {
            tied = true;
        }
    }
    (best.1 > 0.0 && !tied).then_some(best.0)
}
