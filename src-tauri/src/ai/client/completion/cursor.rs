//! The word or clause the cursor is in, and a reply cut to join it: the
//! part the writer already typed taken off again.

/// Chinese or Japanese typed so far in the clause the cursor ends, at most
/// its last ten characters: what word_at_cursor is for spaced languages.
/// Written out again by the model, a word the cursor breaks off comes back
/// whole - left to start after it, Haiku doubled its first half
/// ("十分" + "分钟", "想把" + "把…") or ran past it ("就停" + "，走回家")
/// in the typing replay (live_eval::completion_replay). None after
/// punctuation or a space, where the clause hasn't begun.
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

/// Scripts written without spaces between words: ideographs, kana and
/// full-width forms, and Thai, Lao, Tibetan, Myanmar and Khmer. Hangul is
/// not among them - Korean spaces its words.
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

/// The word the cursor is in or right after, as typed - what the prompt
/// hands the model in <word-at-cursor>: the trailing run of letters and
/// digits with the joiners inside one written word ("docu", "don't",
/// "well-known", "3.5", "2,300"), or a short word ending in an apostrophe -
/// an elision ("l'", "qu'") or a contraction cut off ("don'"). None when the
/// text ends in a space, in punctuation, after a longer word's apostrophe
/// (a closing quote, "the students'") or in a script written without
/// spaces, where the next text simply follows.
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

/// How many bytes at the start of `text` repeat the end of `before`: the
/// word at the cursor written out as the prompt asks, or a longer echo
/// ("Lessons from" + "Lessons from a..."). A repeat in a spaced script
/// starts where a word starts - never in the middle of one, or the tail of
/// "don't" would eat the "t" of a next word "think" - and runs to the end of
/// the before-text; after a script written without spaces, two or more
/// characters count ("结果" + "结果排队", "常用" + "常用药品"), which
/// nothing else would cut: the frontend's stripEcho only takes overlaps of
/// six or more.
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

/// The reply without what would double up at the join: a clause mark the
/// text already ends with ("，" after "，"), or an ellipsis it opened
/// with - the writer's sentence goes straight on. Haiku wrote both after
/// Chinese clauses in the typing replay (live_eval::completion_replay),
/// where they read as "120 份，，" and "再提醒……学生".
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

/// Joins one continuation onto the text before the cursor. The word the
/// cursor is in or right after went to the model in a tag of its own
/// (word_at_cursor), to be written out in full: cutting the typed letters
/// off again leaves exactly the rest of a cut-off word ("docu" + "document
/// is" -> "ment is") or a space and the next word ("quickly" + "quickly
/// grew" -> " grew"). A longer echo of the before-text goes too. A model
/// that left the word out gets the space a new word needs - except after an
/// elision ("l'" + "hôtel"). Models never begin a reply with a space on
/// their own, which is why this can't be left to them.
pub(crate) fn fit_to_cursor(before: &str, text: &str) -> String {
    // Spaces the model led with are its guess at the join, which is made
    // here instead - except at the start of a line, where they are code
    // indentation.
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
        // The model went on without writing out the word at the cursor,
        // with letters: a next word ("and" + "the shelves") or the rest of
        // a cut-off one ("Berufst" + "ätige") - which only the model knew.
        // When the text already uses the typed word, or the reply's first
        // word, as a whole word, it is a word and the reply a new one;
        // anything else is dropped rather than guessed: in the live eval
        // those were cut-off words every time, and two of three continued
        // them wrongly ("docu" + "ument", "co" + "ming").
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
