//! A completion reply made fit to show: wrapping and invented figures
//! dropped, and cut to its first clause or sentence.

use super::*;

/// Removes what never belongs in a suggestion: stray tags, line breaks at
/// either end outside code, backticks a plain-text context doesn't use. A reply
/// still running over several lines outside code is dropped whole.
pub(crate) fn clean_reply(before: &str, after: &str, text: &str, in_code: bool) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(open) = rest.find('<') {
        out.push_str(&rest[..open]);
        let candidate = &rest[open..];
        let close = candidate.find('>').filter(|&close| {
            let name = candidate[1..close].trim_start_matches('/');
            name.chars().next().is_some_and(|c| c.is_ascii_alphabetic())
                && name
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
        });
        match close {
            Some(close) => {
                let tag = &candidate[..=close];
                if before.contains(tag) || after.contains(tag) {
                    out.push_str(tag);
                }
                rest = &candidate[close + 1..];
            }
            None => {
                out.push('<');
                rest = &candidate[1..];
            }
        }
    }
    out.push_str(rest);
    if in_code {
        return out;
    }
    let mut out = out.trim_matches(['\n', '\r']);
    if out.contains('\n') {
        // One exception: an answer the model stated twice, with talk in between,
        // is its answer.
        let mut lines = out.lines().map(str::trim).filter(|l| !l.is_empty());
        match (lines.next(), lines.next_back()) {
            (Some(first), Some(last)) if first == last => out = first,
            _ => return String::new(),
        }
    }
    let out = unwrap_quotes(out);
    if before.contains('`') || after.contains('`') {
        out.to_string()
    } else {
        out.replace('`', "")
    }
}

/// Whether a suggestion carries a figure (a time, a count, a status code) the
/// text around the cursor doesn't. The next number in a counted sequence is
/// fine; "2,300" and "2300" are one figure.
pub(crate) fn invents_figures(before: &str, after: &str, text: &str) -> bool {
    let figures = |s: &str| -> Vec<String> {
        s.split(|c: char| !c.is_ascii_digit() && c != ',' && c != '.')
            .map(|t| t.trim_matches(|c| c == ',' || c == '.').replace(',', ""))
            .filter(|t| t.chars().any(|c| c.is_ascii_digit()))
            .collect()
    };
    let known = figures(&format!("{before}\n{after}"));
    let next = known
        .iter()
        .filter_map(|n| n.parse::<u64>().ok())
        .max()
        .map(|n| (n + 1).to_string());
    figures(text)
        .iter()
        .any(|f| !known.contains(f) && Some(f) != next.as_ref())
}

/// A suggestion the model wrapped whole in ASCII quotes, around Chinese or
/// Japanese text that never quotes with them.
pub(crate) fn unwrap_quotes(text: &str) -> &str {
    for q in ['\'', '"'] {
        if let Some(inner) = text.strip_prefix(q).and_then(|t| t.strip_suffix(q)) {
            if !inner.contains(q) && inner.chars().any(is_unspaced_script) {
                return inner;
            }
        }
    }
    text
}

/// The model's reply as the editor gets it: each candidate cleaned and fitted
/// to the cursor, the separator lines kept, each later candidate opening with
/// exactly one newline. As the writer types, only its first clause.
pub(crate) fn finish_suggestion(
    before: &str,
    after: &str,
    raw: &str,
    hints: &CompletionHints,
) -> String {
    let in_code = hints.block.as_deref() == Some(CODE_BLOCK_HINT);
    let as_you_type =
        hints.length.as_deref() != Some("long") && hints.candidates.is_none_or(|n| n <= 1);
    if !as_you_type {
        return finish_completion(before, after, raw, in_code);
    }
    let text = finish_completion(before, after, raw, in_code);
    if in_code {
        text
    } else {
        first_clause(&first_sentence(&text))
    }
}

/// `text` up to the end of its first clause once it has a few words, and never
/// more than a short line: past that the model went its own way.
pub(crate) fn first_clause(text: &str) -> String {
    const CJK_MIN: usize = 6;
    const CJK_MAX: usize = 24;
    const WORDS_MIN: usize = 3;
    const WORDS_MAX: usize = 15;
    let chars: Vec<char> = text.chars().collect();
    let cjk = chars.iter().filter(|c| is_unspaced_script(**c)).count() * 2 > chars.len();
    let mut letters = 0;
    let mut words = 0;
    let mut in_word = false;
    for (i, &c) in chars.iter().enumerate() {
        if cjk {
            if c.is_alphanumeric() {
                letters += 1;
            }
        } else if c.is_alphanumeric() {
            if !in_word {
                words += 1;
            }
            in_word = true;
        } else {
            in_word = false;
        }
        let enough = if cjk {
            letters >= CJK_MIN
        } else {
            words >= WORDS_MIN
        };
        if enough && "，,；;：:".contains(c) {
            // The clause and its mark: the writer goes on from there.
            return chars[..=i].iter().collect();
        }
        let too_long = if cjk {
            letters > CJK_MAX
        } else {
            words > WORDS_MAX
        };
        if too_long {
            let cut: String = chars[..i].iter().collect();
            // Before the word it was in, for the spaced scripts.
            return if cjk {
                cut
            } else {
                cut.trim_end_matches(|c: char| c.is_alphanumeric())
                    .trim_end()
                    .to_string()
            };
        }
    }
    text.to_string()
}

/// `text` up to the end of its first sentence. A full stop counts before a
/// space or the end, not inside "3.5"; closing quotes after it stay with it.
pub(crate) fn first_sentence(text: &str) -> String {
    const CLOSERS: &str = "”’\"')）」』]";
    let chars: Vec<char> = text.chars().collect();
    for (i, &c) in chars.iter().enumerate() {
        if i == 0 || !"。！？….!?".contains(c) {
            continue;
        }
        let mut end = i + 1;
        while chars.get(end).is_some_and(|n| CLOSERS.contains(*n)) {
            end += 1;
        }
        // A full stop of the spaced scripts ends a sentence before a space
        // or the end only: "3.5", "e.g." mid-sentence go on.
        let spaced = matches!(c, '.' | '!' | '?');
        if !spaced || chars.get(end).is_none_or(|n| n.is_whitespace()) {
            return chars[..end].iter().collect();
        }
    }
    text.to_string()
}

pub(crate) fn finish_completion(before: &str, after: &str, raw: &str, in_code: bool) -> String {
    let parts = raw.split(CANDIDATE_SEPARATOR).count();
    raw.split(CANDIDATE_SEPARATOR)
        .enumerate()
        .map(|(i, part)| {
            let (lead, part) = if i == 0 {
                ("", part)
            } else {
                ("\n", part.trim_start_matches('\n'))
            };
            let body = part.trim_end_matches('\n');
            let tail = if i + 1 == parts && !in_code {
                ""
            } else {
                &part[body.len()..]
            };
            let body = clean_reply(before, after, body, in_code);
            if body.trim().is_empty() || (!in_code && invents_figures(before, after, &body)) {
                format!("{lead}{tail}")
            } else if in_code {
                format!("{lead}{}{tail}", fit_to_cursor(before, &body))
            } else {
                // The conventions the text before the cursor already follows.
                let fitted = fit_to_cursor(before, &body);
                format!(
                    "{lead}{}{tail}",
                    crate::ai::rules::postfix::completion(before, &fitted)
                )
            }
        })
        .collect::<Vec<_>>()
        .join(CANDIDATE_SEPARATOR)
}
