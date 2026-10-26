//! The text a rule looks at: one block of plain text with char offsets, a
//! regex-friendly copy, and a mask of spans no rule may touch (URLs, e-mail
//! addresses, paths, inline code and math, and their placeholders).

use regex::Regex;
use std::sync::LazyLock;

/// Stands in for an inline code span or inline math inside a block's text, so
/// rules see a boundary there and never its contents.
pub(crate) const PLACEHOLDER: char = '\u{FFFC}';

pub(crate) fn is_han(c: char) -> bool {
    matches!(c,
        '\u{4E00}'..='\u{9FFF}'
        | '\u{3400}'..='\u{4DBF}'
        | '\u{F900}'..='\u{FAFF}'
        | '\u{20000}'..='\u{2EBEF}'
        | '\u{2F800}'..='\u{2FA1F}'
        | '\u{3007}')
}

pub(crate) fn is_kana(c: char) -> bool {
    matches!(c, '\u{3041}'..='\u{309F}' | '\u{30A0}'..='\u{30FF}' | '\u{31F0}'..='\u{31FF}')
}

pub(crate) fn is_halfwidth_kana(c: char) -> bool {
    matches!(c, '\u{FF65}'..='\u{FF9F}')
}

pub(crate) fn is_hangul(c: char) -> bool {
    matches!(c, '\u{AC00}'..='\u{D7AF}' | '\u{1100}'..='\u{11FF}' | '\u{3130}'..='\u{318F}')
}

/// Chinese or Japanese letters: ideographs and kana.
pub(crate) fn is_cjk(c: char) -> bool {
    is_han(c) || is_kana(c)
}

/// Full-width punctuation proper: the CJK symbols block and the
/// full-width forms of ASCII punctuation (，。、；：？！（）《》「」…).
pub(crate) fn is_fullwidth_punct(c: char) -> bool {
    matches!(c,
        '\u{3001}'..='\u{3003}'
        | '\u{3008}'..='\u{3011}'
        | '\u{3014}'..='\u{301F}'
        | '\u{FF01}'..='\u{FF0F}'
        | '\u{FF1A}'..='\u{FF20}'
        | '\u{FF3B}'..='\u{FF40}'
        | '\u{FF5B}'..='\u{FF64}')
}

/// A character of CJK running text: a CJK letter or a full-width mark.
pub(crate) fn is_cjk_text(c: char) -> bool {
    is_cjk(c) || is_fullwidth_punct(c)
}

pub(crate) fn is_latin_letter(c: char) -> bool {
    c.is_ascii_alphabetic()
        || matches!(c, '\u{00C0}'..='\u{00D6}' | '\u{00D8}'..='\u{00F6}' | '\u{00F8}'..='\u{024F}' | '\u{1E00}'..='\u{1EFF}')
}

pub(crate) fn is_cyrillic(c: char) -> bool {
    matches!(c, '\u{0400}'..='\u{04FF}')
}

/// A letter or digit of a script that spaces its words (Latin, Cyrillic,
/// Greek, Hangul) - what "a word" means to the word rules.
pub(crate) fn is_word_char(c: char) -> bool {
    (c.is_alphanumeric() && !is_cjk(c)) || c == '_'
}

/// Latin letters and digits - the "half-width" side of CJK-Latin spacing.
pub(crate) fn is_latin_or_digit(c: char) -> bool {
    c.is_ascii_alphanumeric() || is_latin_letter(c)
}

static URL: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(?:https?|ftp|file|mailto)://[^\s<>\x22'“”‘’「」『』（）()\[\]{}，。、；！？\p{Han}\p{Hiragana}\p{Katakana}\p{Hangul}]+|\bwww\.[a-z0-9-]+\.[^\s<>\x22'“”（）()\[\]{}，。、；！？\p{Han}\p{Hiragana}\p{Katakana}\p{Hangul}]+")
        .unwrap()
});
static EMAIL: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"[A-Za-z0-9_.+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+").unwrap());
static CODE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"`[^`\n]+`").unwrap());
/// A path: one with a root (`/`, `~/`, `./`, `C:\`), several separators, or
/// a file name with an extension - so "and/or" and "he/she" stay words.
static PATH: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?:[A-Za-z]:\\|~/|\.{1,2}/|/)[A-Za-z0-9_.@~+-]+(?:[/\\][A-Za-z0-9_.@~+-]*)*|[A-Za-z0-9_.@~+-]+(?:[/\\][A-Za-z0-9_@~+-]+){2,}[/\\]?[A-Za-z0-9_.@~+-]*|[A-Za-z0-9_@~+-]+(?:[/\\][A-Za-z0-9_@~+-]+)*[/\\][A-Za-z0-9_@~+-]+\.[A-Za-z0-9]{1,8}\b")
        .unwrap()
});
static MATH: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\$[^\s$\d][^$\n]*?\$").unwrap());

/// One block of plain text as the rules see it.
pub(crate) struct Text {
    pub s: String,
    pub chars: Vec<char>,
    /// Byte offset in `s` -> char index (one entry per byte, plus the end).
    b2c: Vec<usize>,
    pub protected: Vec<bool>,
}

impl Text {
    pub fn new(s: &str) -> Text {
        let chars: Vec<char> = s.chars().collect();
        let mut b2c = vec![0; s.len() + 1];
        for (ci, (bi, ch)) in s.char_indices().enumerate() {
            for slot in b2c.iter_mut().skip(bi).take(ch.len_utf8()) {
                *slot = ci;
            }
        }
        b2c[s.len()] = chars.len();
        let mut t = Text {
            s: s.to_string(),
            protected: vec![false; chars.len()],
            chars,
            b2c,
        };
        for re in [&*URL, &*EMAIL, &*CODE, &*PATH] {
            // A root slash starts a path only at the start of a token:
            // the "/or" of "and/or" and the "/2" of "1/2" are not paths.
            let ranges: Vec<(usize, usize)> = t
                .find(re)
                .filter(|&(a, _)| {
                    !(matches!(t.chars[a], '/' | '\\')
                        && t.before(a).is_some_and(|c| c.is_alphanumeric()))
                })
                .collect();
            for (a, mut b) in ranges {
                // A sentence's own full stop or comma after a URL isn't
                // part of it.
                while b > a && matches!(t.chars[b - 1], '.' | ',' | ';' | ':' | '!' | '?' | ')') {
                    b -= 1;
                }
                t.protect(a, b);
            }
        }
        let math: Vec<(usize, usize)> = t
            .find(&MATH)
            .filter(|&(_, b)| !t.chars.get(b).is_some_and(|c| c.is_ascii_digit()))
            .collect();
        for (a, b) in math {
            t.protect(a, b);
        }
        for i in 0..t.chars.len() {
            if t.chars[i] == PLACEHOLDER {
                t.protected[i] = true;
            }
        }
        t
    }

    pub fn len(&self) -> usize {
        self.chars.len()
    }

    fn protect(&mut self, a: usize, b: usize) {
        for p in &mut self.protected[a..b] {
            *p = true;
        }
    }

    /// The char index of a byte offset into `s`.
    pub fn ci(&self, byte: usize) -> usize {
        self.b2c[byte]
    }

    /// Char ranges of every match of `re`.
    pub fn find<'a>(&'a self, re: &'a Regex) -> impl Iterator<Item = (usize, usize)> + 'a {
        re.find_iter(&self.s)
            .map(|m| (self.ci(m.start()), self.ci(m.end())))
    }

    /// Captures of every match of `re`, as char ranges per group.
    pub fn captures<'a>(
        &'a self,
        re: &'a Regex,
    ) -> impl Iterator<Item = Vec<Option<(usize, usize)>>> + 'a {
        re.captures_iter(&self.s).map(|c| {
            c.iter()
                .map(|m| m.map(|m| (self.ci(m.start()), self.ci(m.end()))))
                .collect()
        })
    }

    pub fn at(&self, i: usize) -> Option<char> {
        self.chars.get(i).copied()
    }

    /// The char before index `i`, if any.
    pub fn before(&self, i: usize) -> Option<char> {
        i.checked_sub(1).map(|j| self.chars[j])
    }

    pub fn slice(&self, a: usize, b: usize) -> String {
        self.chars[a..b].iter().collect()
    }

    /// Whether any char in `a..b` is protected.
    pub fn guarded(&self, a: usize, b: usize) -> bool {
        self.protected[a.min(self.len())..b.min(self.len())]
            .iter()
            .any(|&p| p)
    }

    /// Whether `a..b` sits inside a quotation or dialogue: an opening quote
    /// before it on the same line with no closing one in between, and a
    /// closing one after it.
    pub fn in_quotes(&self, a: usize, b: usize) -> bool {
        const PAIRS: [(char, char); 7] = [
            ('“', '”'),
            ('「', '」'),
            ('『', '』'),
            ('«', '»'),
            ('„', '“'),
            ('‘', '’'),
            ('»', '«'),
        ];
        for (open, close) in PAIRS {
            let opened = self.chars[..a]
                .iter()
                .rposition(|&c| c == open || c == '\n')
                .is_some_and(|i| self.chars[i] == open && !self.chars[i + 1..a].contains(&close));
            if opened && self.chars[b.min(self.len())..].contains(&close) {
                return true;
            }
        }
        let straight = self.chars[..a].iter().filter(|&&c| c == '"').count();
        straight % 2 == 1 && self.chars[b.min(self.len())..].contains(&'"')
    }

    /// Whether `i` starts a sentence: nothing but spaces, opening quotes or
    /// brackets since the start or since a sentence-ending mark.
    pub fn sentence_start(&self, i: usize) -> bool {
        let mut j = i;
        while j > 0 {
            let c = self.chars[j - 1];
            if c.is_whitespace()
                || matches!(
                    c,
                    '"' | '“' | '«' | '„' | '(' | '[' | '¿' | '¡' | '—' | '–' | '-' | '\'' | '‘'
                )
            {
                j -= 1;
                continue;
            }
            return matches!(c, '.' | '!' | '?' | '…' | ':' | '。' | '！' | '？');
        }
        true
    }

    /// The word (letters, digits, apostrophes inside) that starts at `a`.
    pub fn word_at(&self, a: usize) -> (usize, usize) {
        let mut b = a;
        while b < self.len()
            && (is_word_char(self.chars[b])
                || (matches!(self.chars[b], '\'' | '’')
                    && b + 1 < self.len()
                    && is_word_char(self.chars[b + 1])
                    && b > a))
        {
            b += 1;
        }
        (a, b)
    }

    /// Words as (start, end) char ranges.
    pub fn words(&self) -> Vec<(usize, usize)> {
        let mut out = Vec::new();
        let mut i = 0;
        while i < self.len() {
            if is_word_char(self.chars[i]) && !self.before(i).is_some_and(is_word_char) {
                let (a, b) = self.word_at(i);
                out.push((a, b));
                i = b.max(i + 1);
            } else {
                i += 1;
            }
        }
        out
    }
}

/// Every occurrence of `word` in `t` as a whole word (no word character on
/// either side), matched exactly or, with `ci`, ignoring case.
pub(crate) fn find_word(t: &Text, word: &str, ci: bool) -> Vec<(usize, usize)> {
    let w: Vec<char> = word.chars().collect();
    let n = w.len();
    let mut out = Vec::new();
    if n == 0 || n > t.len() {
        return out;
    }
    let eq = |a: char, b: char| {
        if ci {
            a.to_lowercase().eq(b.to_lowercase())
        } else {
            a == b
        }
    };
    let boundary_needed_left = w.first().is_some_and(|&c| is_word_char(c));
    let boundary_needed_right = w.last().is_some_and(|&c| is_word_char(c));
    for i in 0..=t.len() - n {
        if (0..n).all(|k| eq(t.chars[i + k], w[k]))
            && !(boundary_needed_left && t.before(i).is_some_and(is_word_char))
            && !(boundary_needed_right && t.at(i + n).is_some_and(is_word_char))
        {
            out.push((i, i + n));
        }
    }
    out
}

/// Every occurrence of `needle` in `t`, as a substring.
pub(crate) fn find_str(t: &Text, needle: &str) -> Vec<(usize, usize)> {
    let w: Vec<char> = needle.chars().collect();
    let n = w.len();
    if n == 0 || n > t.len() {
        return Vec::new();
    }
    (0..=t.len() - n)
        .filter(|&i| t.chars[i..i + n] == w[..])
        .map(|i| (i, i + n))
        .collect()
}

/// `replacement` cased like `original`: Capitalised or ALL CAPS.
pub(crate) fn match_case(original: &str, replacement: &str) -> String {
    let letters: Vec<char> = original.chars().filter(|c| c.is_alphabetic()).collect();
    if letters.len() > 1 && letters.iter().all(|c| c.is_uppercase()) {
        return replacement.to_uppercase();
    }
    if letters.first().is_some_and(|c| c.is_uppercase()) {
        let mut cs = replacement.chars();
        return match cs.next() {
            Some(f) => f.to_uppercase().chain(cs).collect(),
            None => String::new(),
        };
    }
    replacement.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn urls_paths_code_and_math_are_protected() {
        let t = Text::new("见 https://a.com/x,然后 `a,b` 和 src/main.rs 与 $x,y$ 以及 a@b.cn。");
        let prot = |needle: &str| {
            let (a, b) = find_str(&t, needle)[0];
            (a..b).all(|i| t.protected[i])
        };
        assert!(prot("https://a.com/x"));
        assert!(!t.protected[find_str(&t, ",然后")[0].0]);
        assert!(prot("`a,b`"));
        assert!(prot("src/main.rs"));
        assert!(prot("$x,y$"));
        assert!(prot("a@b.cn"));
        // Words with a slash and currency are not paths or math.
        let t = Text::new("and/or he/she costs $5 and $10");
        assert!(!t.protected.iter().any(|&p| p));
    }

    #[test]
    fn quotes_and_sentence_starts() {
        let t = Text::new("He said “the the end” and left. Then she spoke.");
        let (a, b) = find_str(&t, "the the")[0];
        assert!(t.in_quotes(a, b));
        assert!(!t.in_quotes(0, 2));
        assert!(t.sentence_start(find_str(&t, "Then")[0].0));
        assert!(!t.sentence_start(find_str(&t, "she")[0].0));
        assert_eq!(match_case("Fué", "fue"), "Fue");
        assert_eq!(match_case("ALOT", "a lot"), "A LOT");
        assert_eq!(find_word(&t, "the", true).len(), 2);
    }
}
