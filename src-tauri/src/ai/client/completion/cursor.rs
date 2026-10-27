//! The word or clause the cursor is in, and a reply cut to join it: the
//! part the writer already typed taken off again.

/// Chinese or Japanese typed so far in the clause the cursor ends, at most its
/// last ten characters, written out again so a broken-off word comes back whole.
/// None after punctuation or a space.
pub(crate) fn clause_at_cursor(before: &str) -> Option<&str> {
    let run = |c: char| is_unspaced_script(c) && c.is_alphanumeric();
    let mut start = before.len();
    let mut count = 0;
    for (at, c) in before.char_indices().rev() {
        if !run(c) || count == 10 {
            break;
        }
        start = at;
        count += 1;
    }
    (count > 0).then(|| &before[start..])
}

/// Scripts written without spaces between words. Hangul is not among them:
/// Korean spaces its words.
pub(crate) fn is_unspaced_script(c: char) -> bool {
    matches!(c,
        '\u{0e00}'..='\u{109f}'
        | '\u{1780}'..='\u{17ff}'
        | '\u{2e80}'..='\u{9fff}'
        | '\u{f900}'..='\u{faff}'
        | '\u{ff00}'..='\u{ffef}'
        | '\u{20000}'..='\u{3134f}')
}

pub(crate) fn is_word_char(c: char) -> bool {
    c.is_alphanumeric() && !is_unspaced_script(c)
}

/// What holds letters together in one written word: "don't", "C'est",
/// "well-known", "3.5", "total_count".
pub(crate) const WORD_JOINERS: [char; 5] = ['\'', '\u{2019}', '-', '.', '_'];

pub(crate) fn is_apostrophe(c: char) -> bool {
    c == '\'' || c == '\u{2019}'
}

/// The word the cursor is in or right after, as typed ("docu", "don't",
/// "2,300"), or a short elision ending in an apostrophe ("l'"). None after a
/// space, punctuation, a closing apostrophe, or in an unspaced script.
pub(crate) fn word_at_cursor(before: &str) -> Option<&str> {
    let chars: Vec<(usize, char)> = before.char_indices().collect();
    let n = chars.len();
    let (_, last) = *chars.last()?;
    // The token's last letter or digit.
    let end = if is_word_char(last) {
        n - 1
    } else if is_apostrophe(last) && n >= 2 && is_word_char(chars[n - 2].1) {
        n - 2
    } else {
        return None;
    };
    let mut start = end;
    while start > 0 {
        let c = chars[start - 1].1;
        // A joiner counts only inside the word, between two of its letters
        // (a comma only between digits: "2,300").
        let inside = start >= 2
            && is_word_char(chars[start - 2].1)
            && (WORD_JOINERS.contains(&c)
                || (c == ','
                    && chars[start - 2].1.is_ascii_digit()
                    && chars[start].1.is_ascii_digit()));
        if is_word_char(c) || inside {
            start -= 1;
        } else {
            break;
        }
    }
    if end != n - 1 && end - start >= 3 {
        return None;
    }
    Some(&before[chars[start].0..])
}

/// How many bytes at the start of `text` repeat the end of `before`. In a
/// spaced script a repeat starts where a word starts; after an unspaced script,
/// two or more characters count, which the frontend's stripEcho would miss.
pub(crate) fn echoed_len(before: &str, text: &str) -> usize {
    let chars: Vec<(usize, char)> = before.char_indices().collect();
    let n = chars.len();
    for k in n.saturating_sub(120)..n {
        let (at, c) = chars[k];
        let prev = (k > 0).then(|| chars[k - 1].1);
        let word_start = is_word_char(c)
            && !prev.is_some_and(is_word_char)
            && !(prev.is_some_and(is_apostrophe) && k >= 2 && is_word_char(chars[k - 2].1));
        let unspaced = is_unspaced_script(c) && n - k >= 2;
        if (word_start || unspaced) && text.starts_with(&before[at..]) {
            return before.len() - at;
        }
    }
    0
}

/// The reply without what would double up at the join: a clause mark the text
/// already ends with ("，" after "，"), or an ellipsis it opened with.
pub(crate) fn drop_doubled_lead<'a>(before: &str, text: &'a str) -> &'a str {
    let text = text
        .strip_prefix("……")
        .or_else(|| text.strip_prefix("..."))
        .or_else(|| text.strip_prefix('…'))
        .map(|rest| rest.trim_start_matches([' ', '\t']))
        .unwrap_or(text);
    match (
        before.trim_end_matches(' ').chars().last(),
        text.chars().next(),
    ) {
        (Some(last), Some(first)) if last == first && "，,；;、：:".contains(first) => {
            text[first.len_utf8()..].trim_start_matches([' ', '\t'])
        }
        _ => text,
    }
}

/// Joins one continuation onto the text before the cursor, cutting off the
/// typed letters of the word the model wrote out in full ("docu" + "document
/// is" -> "ment is"). A model that left the word out gets the space it needs.
pub(crate) fn fit_to_cursor(before: &str, text: &str) -> String {
    // Leading spaces are the model's guess at the join, made here instead,
    // except at the start of a line, where they are code indentation.
    let text = if before.ends_with('\n') {
        text
    } else {
        drop_doubled_lead(before, text.trim_start_matches([' ', '\t']))
    };
    if let Some(rest) = clause_at_cursor(before).and_then(|clause| text.strip_prefix(clause)) {
        return rest.to_string();
    }
    let echoed = echoed_len(before, text);
    if echoed > 0 {
        return text[echoed..].to_string();
    }
    let Some(first) = text.chars().next() else {
        return String::new();
    };
    let needs_space = match word_at_cursor(before) {
        // The model went on without writing out the word at the cursor. If the text
        // already uses that word or the reply's first word whole, it's a new word;
        // otherwise drop it: those were cut-off words, usually continued wrongly.
        Some(word) if is_word_char(first) && !word.ends_with(is_apostrophe) => {
            let next: String = text.chars().take_while(|&c| is_word_char(c)).collect();
            if !used_as_whole_word(&before[..before.len() - word.len()], word)
                && !used_as_whole_word(before, &next)
            {
                return String::new();
            }
            true
        }
        // After a word, anything but what attaches to it ("," ")" "'s"
        // "-based") starts something new.
        Some(word) => {
            !word.ends_with(is_apostrophe)
                && !first.is_whitespace()
                && !is_unspaced_script(first)
                && !",.;:!?)]}%…'’”-/".contains(first)
        }
        // After punctuation, a word or an opening quote or bracket does.
        None => {
            (is_word_char(first) || "(\"“‘`".contains(first))
                && before
                    .chars()
                    .last()
                    .is_some_and(|c| ".,;:!?)]}\"'”’…".contains(c))
        }
    };
    if needs_space {
        format!(" {text}")
    } else {
        text.to_string()
    }
}

/// Whether `word` occurs in `text` as a whole word (any case) - evidence
/// that the same letters at the cursor are a complete word too.
pub(crate) fn used_as_whole_word(text: &str, word: &str) -> bool {
    let (text, word) = (text.to_lowercase(), word.to_lowercase());
    text.match_indices(&word).any(|(at, _)| {
        let before_ok = !text[..at].chars().next_back().is_some_and(is_word_char);
        let after_ok = !text[at + word.len()..]
            .chars()
            .next()
            .is_some_and(is_word_char);
        before_ok && after_ok
    })
}
