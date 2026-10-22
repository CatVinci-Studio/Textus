//! A completion reply made fit to show: wrapping and invented figures
//! dropped, and cut to its first clause or sentence.

use super::*;

/// Removes what never belongs in a suggestion, before it is fitted: tags
/// that aren't in the document (Haiku with thinking off once ended a word
/// with "</reasoning_effort>"); outside code, line breaks at either end -
/// including those a removed tag leaves behind ("率\n\n<br>" in a table
/// cell, round-2 integration) - and the backticks a plain-text context
/// doesn't use (Tab inserts plain text, so "`max_retries`" would land as
/// literal backticks). A reply that still runs over several lines outside
/// code is dropped whole: the prompt rules line breaks out there, and in
/// the live eval every such reply was the model's reasoning about the
/// prompt or a second block - an empty suggestion costs
/// one pause, garbage costs a Tab and a cleanup.
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
        // One exception: the model answered, talked to itself, then gave
        // the same answer again ("率\n\n</reasoning_effort>\n\nWait, I must
        // not include tags. Output the cell content only.\n\n率", round 4,
        // zh/table-cell) - an answer it stated twice is its answer.
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

/// Whether a suggestion carries a figure the text around the cursor
/// doesn't - a time, a count, a status code. The prompt rules invented
/// figures out, and Haiku still wrote "返回 200" into a deployment step and
/// "오전 9시부터 오후 9시까지" as a library's hours (round 4); a figure the
/// writer didn't give is the kind of invention they may not notice before
/// sending. The next number in a sequence the text counts (step 3 after
/// step 2) is fine. Formatting differences ("2,300" and "2300") are one
/// figure.
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
/// Japanese text that never quotes with them: "時'就需要先傾聽居民的意見。'"
/// (round 4, lang/zh-Hant/mid) - the quotes are the model's, not text.
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

/// The model's reply as the editor should get it: each candidate cleaned
/// (clean_reply) and fitted to the cursor, the separator lines kept for the
/// frontend's splitCandidates. A newline the first (or only) candidate
/// opens with inside code is its own - code going on on the next line,
/// whose indentation must survive - while after a separator, newlines only
/// end the separator's line: each later candidate gets exactly one, so the
/// frontend can split there and keep the joining space that follows it.
/// Newlines a candidate ends with only lead into the next separator, so
/// outside code the last one keeps none: the as-you-type path shows the
/// reply as it is, and "率\n" in a table cell would insert the line break.
/// The reply as the editor gets it, for this request (finish_completion):
/// as the writer types (`length` short, one candidate), only to the end of
/// its first clause; an explicit continuation as it came.
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

/// `text` up to the end of its first clause once it has a few words, and
/// never more than a short line. Asked for 5 to 20 characters, Haiku wrote
/// 20 to 60 more often than not, and what came after the first clause was
/// where it went its own way: in the typing replay (completion_replay),
/// suggestions of up to 16 characters were taken nine times in ten, those
/// past 30 little more than half.
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

/// `text` up to the end of its first sentence - an as-you-type suggestion
/// is a few words, and what goes past the sentence the writer is in is
/// what they would have to supply themselves. A full stop counts before a
/// space or the end, not inside "3.5" or "e.g"; closing quotes and
/// brackets right after it stay with it.
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
                // The conventions the text before the cursor already
                // follows (rules::postfix, CATALOGUE.md §3.12).
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
