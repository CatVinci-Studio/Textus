//! How a text writes the conventions sources disagree on, counted over the
//! document (or paragraph). Automatic follows the majority and flags only a
//! clear minority.

use super::detect::Lang;
use super::text::*;
use regex::Regex;
use std::collections::BTreeMap;
use std::sync::LazyLock;

#[derive(Default, Debug, Clone)]
pub(crate) struct Stats {
    /// CJK next to a Latin letter or digit, with one space between / none.
    pub cjk_latin_spaced: usize,
    pub cjk_latin_tight: usize,
    /// Sentence punctuation after a CJK character: full-width / half-width.
    pub cjk_fw_punct: usize,
    pub cjk_hw_punct: usize,
    /// Double quotes: straight, English curly “”, German „“, guillemets
    /// «» and »«, corner brackets 「」.
    pub dq_straight: usize,
    pub dq_curly: usize,
    pub dq_low: usize,
    pub dq_guillemet: usize,
    pub dq_guillemet_rev: usize,
    pub dq_corner: usize,
    /// Apostrophes between letters: ' / ’.
    pub apos_straight: usize,
    pub apos_curly: usize,
    /// Before French ; : ! ? - nothing, a space, NBSP, NNBSP.
    pub fr_none: usize,
    pub fr_space: usize,
    pub fr_nbsp: usize,
    pub fr_nnbsp: usize,
    /// … / ... in Latin text.
    pub ellipsis_char: usize,
    pub ellipsis_dots: usize,
    /// word—word / word — word / word – word.
    pub dash_em_tight: usize,
    pub dash_em_spaced: usize,
    pub dash_en_spaced: usize,
    /// 5 % / 5%.
    pub pct_spaced: usize,
    pub pct_tight: usize,
    /// 3 pm / 15:00.
    pub clock12: usize,
    pub clock24: usize,
    /// Japanese 、。 / ，．
    pub ja_touten: usize,
    pub ja_comma: usize,
    pub ja_kuten: usize,
    pub ja_period: usize,
    /// Japanese sentence endings: です・ます / である.
    pub ja_desu: usize,
    pub ja_dearu: usize,
    /// Korean sentence endings: 하십시오체 / 해요체.
    pub ko_formal: usize,
    pub ko_polite: usize,
    /// English spelling families.
    pub en_us: usize,
    pub en_uk: usize,
    /// German ß present anywhere.
    pub de_eszett: usize,
    /// Chinese dashes: —— / ──.
    pub zh_em_dash: usize,
    pub zh_box_dash: usize,
    /// Katakana words, for ja.word.choon.
    pub katakana: BTreeMap<String, usize>,
    /// Words whose spelling varies, by family (okurigana, 子ども/子供).
    pub variants: BTreeMap<&'static str, usize>,
    /// Number grouping in 5+ digit numbers: "12.500" / "12 500" (NBSP or
    /// space) / "12,500".
    pub group_dot: usize,
    pub group_space: usize,
    pub group_comma: usize,
    /// French dialogue paragraphs opening with – / —.
    pub dialogue_en: usize,
    pub dialogue_em: usize,
}

/// Whether instances counted `this` are the clear minority against `other`:
/// at least three of the other kind, and at least twice as many. A tie, or
/// one or two examples, is no majority - nothing gets flagged.
pub(crate) fn minority(this: usize, other: usize) -> bool {
    this > 0 && other >= 3 && other >= 2 * this
}

static DQ_STRAIGHT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#""[^"\n]+""#).unwrap());
static APOS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\p{L}['’]\p{L}").unwrap());
static PCT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\d([ \u{00A0}\u{202F}]?)%").unwrap());
static CLOCK12: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b\d{1,2}(?::\d{2})?\s?(?:a\.?m\.?|p\.?m\.?)(?:\W|$)").unwrap()
});
static CLOCK24: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\b(?:1[3-9]|2[0-3]):[0-5]\d\b").unwrap());
static ELLIPSIS_DOTS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\p{L}\.\.\.").unwrap());
static GROUPED: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\b\d{1,3}(?:([.,\u{00A0}\u{202F} ])\d{3})+\b").unwrap());
static DESU: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?:です|ます|でした|ました|ません|でしょう|ましょう)[。！？]").unwrap()
});
static DEARU: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?:である|であった|ではない|だった|のだ|なのだ)[。！？]").unwrap()
});
static KO_FORMAL: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?:습니다|ㅂ니다|십시오|습니까|입니다|합니다|됩니다)[.?!]").unwrap()
});
static KO_POLITE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"[\p{Hangul}&&[^세]](?:요|죠)[.?!]").unwrap());

/// US/UK spelling pairs (one family per pair). Proper nouns are skipped
/// by the rule; the count only sees lower-case words.
pub(crate) const EN_SPELLING: &[(&str, &str)] = &[
    ("color", "colour"),
    ("colors", "colours"),
    ("favor", "favour"),
    ("favorite", "favourite"),
    ("honor", "honour"),
    ("labor", "labour"),
    ("behavior", "behaviour"),
    ("neighbor", "neighbour"),
    ("flavor", "flavour"),
    ("humor", "humour"),
    ("rumor", "rumour"),
    ("center", "centre"),
    ("centers", "centres"),
    ("theater", "theatre"),
    ("meter", "metre"),
    ("liter", "litre"),
    ("fiber", "fibre"),
    ("defense", "defence"),
    ("offense", "offence"),
    ("catalog", "catalogue"),
    ("dialog", "dialogue"),
    ("analog", "analogue"),
    ("traveled", "travelled"),
    ("traveling", "travelling"),
    ("traveler", "traveller"),
    ("canceled", "cancelled"),
    ("canceling", "cancelling"),
    ("modeling", "modelling"),
    ("labeled", "labelled"),
    ("gray", "grey"),
    ("aluminum", "aluminium"),
    ("mold", "mould"),
    ("plow", "plough"),
    ("jewelry", "jewellery"),
    ("pajamas", "pyjamas"),
    ("analyze", "analyse"),
    ("analyzed", "analysed"),
    ("paralyze", "paralyse"),
    ("organize", "organise"),
    ("organized", "organised"),
    ("organization", "organisation"),
    ("realize", "realise"),
    ("realized", "realised"),
    ("recognize", "recognise"),
    ("recognized", "recognised"),
    ("apologize", "apologise"),
    ("criticize", "criticise"),
    ("emphasize", "emphasise"),
    ("prioritize", "prioritise"),
    ("summarize", "summarise"),
    ("optimize", "optimise"),
    ("optimization", "optimisation"),
    ("minimize", "minimise"),
    ("maximize", "maximise"),
    ("utilize", "utilise"),
    ("specialize", "specialise"),
    ("customize", "customise"),
    ("finalize", "finalise"),
    ("authorize", "authorise"),
    ("standardize", "standardise"),
];

/// Words spelled two ways in Japanese, as families: okurigana pairs and
/// 子ども/子供. Each family's forms, the first the more common one.
pub(crate) const JA_VARIANTS: &[(&str, &[&str])] = &[
    ("取り扱い", &["取り扱い", "取扱い"]),
    ("申し込み", &["申し込み", "申込み"]),
    ("打ち合わせ", &["打ち合わせ", "打合せ"]),
    ("問い合わせ", &["問い合わせ", "問合せ"]),
    ("引き続き", &["引き続き", "引続き"]),
    ("行う", &["行う", "行なう"]),
    ("表す", &["表す", "表わす"]),
    ("話し合い", &["話し合い", "話合い"]),
    ("書き込み", &["書き込み", "書込み"]),
    ("読み込み", &["読み込み", "読込み"]),
    ("組み合わせ", &["組み合わせ", "組合せ"]),
    ("子ども", &["子ども", "子供"]),
];

impl Stats {
    /// Adds the counts of one block of text in `lang`.
    // Indexing: each char is looked at with its neighbours.
    #[allow(clippy::needless_range_loop)]
    pub fn count(&mut self, t: &Text, lang: Lang) {
        let chars = &t.chars;
        let n = chars.len();
        let cjk_lang = matches!(lang, Lang::ZhHans | Lang::ZhHant | Lang::Ja);
        for i in 0..n {
            let c = chars[i];
            let prev = t.before(i);
            let next = t.at(i + 1);
            if t.protected[i] {
                continue;
            }
            if cjk_lang {
                // CJK-Latin boundaries.
                if is_cjk(c) && next.is_some_and(is_latin_or_digit) {
                    self.cjk_latin_tight += 1;
                }
                if is_latin_or_digit(c) && next.is_some_and(is_cjk) {
                    self.cjk_latin_tight += 1;
                }
                if c == ' ' {
                    if let (Some(p), Some(q)) = (prev, next) {
                        if (is_cjk(p) && is_latin_or_digit(q))
                            || (is_latin_or_digit(p) && is_cjk(q))
                        {
                            self.cjk_latin_spaced += 1;
                        }
                    }
                }
                if prev.is_some_and(is_cjk) {
                    match c {
                        '，' | '。' | '；' | '：' | '？' | '！' | '、' => {
                            self.cjk_fw_punct += 1
                        }
                        ',' | ';' | '?' | '!' => self.cjk_hw_punct += 1,
                        '.' if !next.is_some_and(|q| q.is_ascii_digit() || q == '.') => {
                            self.cjk_hw_punct += 1
                        }
                        ':' if !next.is_some_and(|q| q.is_ascii_digit()) => self.cjk_hw_punct += 1,
                        _ => {}
                    }
                }
            }
            match c {
                '“' => self.dq_curly += 1,
                '„' => self.dq_low += 1,
                '«' => self.dq_guillemet += 1,
                '»' if next.is_some_and(|q| !q.is_whitespace())
                    && !prev.is_some_and(|p| p.is_alphanumeric()) =>
                {
                    self.dq_guillemet_rev += 1
                }
                '「' => self.dq_corner += 1,
                '…' if prev.is_some_and(is_latin_letter) => self.ellipsis_char += 1,
                '—' => match (prev, next) {
                    (Some(' '), Some(' ')) => self.dash_em_spaced += 1,
                    (Some(p), Some(q)) if p.is_alphabetic() && q.is_alphabetic() && !is_cjk(p) => {
                        self.dash_em_tight += 1
                    }
                    _ => {}
                },
                '–' if prev == Some(' ') && next == Some(' ') => self.dash_en_spaced += 1,
                _ => {}
            }
            if lang == Lang::Fr && matches!(c, ';' | ':' | '!' | '?') && i > 0 {
                let digits_around = prev.is_some_and(|p| p.is_ascii_digit())
                    && next.is_some_and(|q| q.is_ascii_digit());
                let emoticon = matches!(next, Some(')' | '(' | 'D' | 'P' | '-'));
                if !digits_around && !emoticon && !matches!(prev, Some('!' | '?')) {
                    match prev {
                        Some(' ') => self.fr_space += 1,
                        Some('\u{00A0}') => self.fr_nbsp += 1,
                        Some('\u{202F}') => self.fr_nnbsp += 1,
                        Some(p) if p.is_alphanumeric() || matches!(p, '»' | ')' | '"' | '”') => {
                            self.fr_none += 1
                        }
                        _ => {}
                    }
                }
            }
            if lang == Lang::De && c == 'ß' {
                self.de_eszett += 1;
            }
            if lang.is_chinese() && c == '—' && next == Some('—') {
                self.zh_em_dash += 1;
            }
            if lang.is_chinese() && c == '─' && next == Some('─') {
                self.zh_box_dash += 1;
            }
        }
        self.dq_straight += t
            .find(&DQ_STRAIGHT)
            .filter(|&(a, b)| !t.guarded(a, b))
            .count();
        for (a, b) in t.find(&APOS) {
            if !t.guarded(a, b) {
                if chars[a + 1] == '\'' {
                    self.apos_straight += 1;
                } else {
                    self.apos_curly += 1;
                }
            }
        }
        for caps in t.captures(&PCT) {
            let Some((a, b)) = caps[1] else { continue };
            if a == b {
                self.pct_tight += 1;
            } else {
                self.pct_spaced += 1;
            }
        }
        self.clock12 += t.find(&CLOCK12).count();
        self.clock24 += t.find(&CLOCK24).count();
        self.ellipsis_dots += t.find(&ELLIPSIS_DOTS).count();
        for caps in t.captures(&GROUPED) {
            let (Some((a, b)), Some((s, _))) = (caps[0], caps[1]) else {
                continue;
            };
            if t.guarded(a, b) || b - a < 6 {
                continue;
            }
            match chars[s] {
                '.' => self.group_dot += 1,
                ',' => self.group_comma += 1,
                _ => self.group_space += 1,
            }
        }
        match lang {
            Lang::Ja => {
                for &c in chars {
                    match c {
                        '、' => self.ja_touten += 1,
                        '，' => self.ja_comma += 1,
                        '。' => self.ja_kuten += 1,
                        '．' => self.ja_period += 1,
                        _ => {}
                    }
                }
                self.ja_desu += t.find(&DESU).count();
                self.ja_dearu += t.find(&DEARU).count();
                let mut i = 0;
                while i < n {
                    if matches!(chars[i], '\u{30A1}'..='\u{30FA}') {
                        let start = i;
                        while i < n && matches!(chars[i], '\u{30A1}'..='\u{30FA}' | 'ー') {
                            i += 1;
                        }
                        if i - start >= 3 {
                            *self.katakana.entry(t.slice(start, i)).or_default() += 1;
                        }
                    } else {
                        i += 1;
                    }
                }
                for (_, forms) in JA_VARIANTS {
                    for form in forms.iter() {
                        let hits = find_str(t, form).len();
                        if hits > 0 {
                            *self.variants.entry(form).or_default() += hits;
                        }
                    }
                }
            }
            Lang::Ko => {
                self.ko_formal += t.find(&KO_FORMAL).count();
                self.ko_polite += t.find(&KO_POLITE).count();
            }
            Lang::En => {
                for (a, b) in t.words() {
                    let w = t.slice(a, b);
                    if w.chars().next().is_some_and(char::is_uppercase) && !t.sentence_start(a) {
                        continue;
                    }
                    let lw = w.to_lowercase();
                    if EN_SPELLING.iter().any(|(us, _)| *us == lw) {
                        self.en_us += 1;
                    } else if EN_SPELLING.iter().any(|(_, uk)| *uk == lw) {
                        self.en_uk += 1;
                    }
                }
            }
            Lang::Fr => match chars.first() {
                Some('–') => self.dialogue_en += 1,
                Some('—') => self.dialogue_em += 1,
                _ => {}
            },
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests;
