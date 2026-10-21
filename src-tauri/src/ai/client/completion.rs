//! Inline completion: the prompt for the text around the caret, and the
//! reply cleaned to fit there.

use super::*;

// The completion contract, end to end:
//   - context: the frontend sends the text around the CURSOR - up to the
//     last 1500 chars before it and the first 300 after (ghost-text-plugin's
//     MAX_CONTEXT_CHARS / MAX_AFTER_CONTEXT_CHARS), and outside code only
//     when some of it is prose (not after a diagram alone). Cursor-
//     anchored, not document-anchored: completing mid-document must
//     continue from the cursor, not from wherever the document happens to
//     end.
//   - where: CompletionHints adds the document title, the heading path to
//     the cursor and the block type, so a list item gets an item and a
//     section gets text about that section.
//   - language: the language of the prose around the cursor, told
//     outright (completion_language) - from the prose alone, with code
//     blocks and diagram source left out, else the app's language. Left to
//     the model, a document opening with a Mermaid diagram (Latin keywords,
//     no prose) got continuations in a language nobody wrote (Russian, in
//     a Chinese app).
//   - length: as the writer types, only the near-certain next words, cut
//     at the first clause (finish_suggestion), and asked for mid-clause
//     only - not right after punctuation or in an empty paragraph, where
//     what comes next is the writer's own choice (ghost-text-plugin); two
//     to four sentences when the writer explicitly triggers a continuation.
//   - the join: a word the cursor is in or right after travels in its own
//     <word-at-cursor> tag - in Chinese and Japanese the clause typed so
//     far, <clause-at-cursor> - the model writes it out in full, and
//     fit_to_cursor cuts the typed part off again (see there for why).
//
// The live eval (live_eval/completion_matrix.rs) found the rules below
// that earlier prompts lacked: models never start a reply with a space, so
// "it quickly" + "grew" landed as "quicklygrew" in every space-separated
// language; "the next concrete detail" read as licence to invent figures
// and findings the writer never gave. Round 2 found that asking the model
// to "repeat the last word when the text ends in a letter" made Haiku,
// which runs with thinking off here, reason about that rule in the visible
// reply ("Wait - the instructions say...", a stray </reasoning_effort>) -
// and it skipped the repeat for most words, so a cut-off word was split
// ("docu ment"). Handing the model the word in a tag of its own leaves it
// nothing to decide.
//
// 1.2.0-rc.6 measured what a writer meets, with a typing replay
// (live_eval/completion_replay.rs: whole documents typed out, a completion
// at each pause, judged against what the writer wrote next). Half of the
// one-sentence suggestions were ignored: past the first clause they made up
// what only the writer knew. They are now the near-certain next words, cut
// at the first clause, and asked for mid-clause only, where they were
// useful seven times in ten (after a full stop, three). A short prompt
// without these rules, and a ✓/? mark of the model's own confidence, were
// tried and dropped: the first made Haiku skip the word at the cursor and
// think out loud about format, and it hardly ever marked a guess.
pub(super) const COMPLETION_INSTRUCTIONS: &str = "You are the inline autocomplete of a markdown writing app. When the writer pauses, you propose the words they would most plausibly write next; they see it as grey text and accept it with Tab.

The input marks the insertion point: <text-before-cursor> ends exactly at the cursor and <text-after-cursor> starts exactly there (it may be empty). When the cursor is inside a word or right after one, that word is not in <text-before-cursor> but in <word-at-cursor>, which comes right after it: the letters typed so far, with the cursor at their end. In Chinese and Japanese the same goes for <clause-at-cursor>. When present, <document-title>, <section> (the headings around the cursor, outermost first) and <block> (what the cursor is in) say where in the document this is. The text is plain text with its formatting removed, and what you write is inserted as plain text.

Write ONLY the text to insert at the cursor:
- When there is a <word-at-cursor>, start with that word written out in full - the same letters, finished if they are only its beginning - and go on from there; the letters already typed are removed before the writer sees your text. It may already be a whole word (for, de, the): then write it unchanged and continue with the next words. Finish a cut-off word as the word the sentence needs (\"the extra freight co\" is cost or costs). That word alone is never the answer: always add what comes after it. Otherwise start right at the last character. In Chinese and Japanese, which have no spaces to tell a word by, there is a <clause-at-cursor> instead when the cursor is in running text: the characters typed so far in the current clause, which may stop partway through a word. Start your text with them exactly as written and go on from there, finishing a word they break off (所以想把 -> 所以想把提交时间…, 先跑十分 -> 先跑十分钟…); they are removed before the writer sees your text.
- Move the text forward with what the text already supports: finish the thought, draw the consequence it sets up, give the next step or point it promises. Never invent facts the writer hasn't given - figures, names, dates, times, findings, causes, quotes, product claims, what a cited study or the writer's own interviews or analysis found or did, function or option names: where the next words would need one, stay general (\"move the meeting to another day\", not \"to next Friday\") or stop. In an empty paragraph after a heading or a finished section, open or connect with what the document already says. Never restate, summarize or paraphrase what is already written. Skip generic filler and stock phrases (pivotal, crucial, delve, \"plays a vital role\", \"not just X but Y\", 至关重要, 不仅……更……) unless the writer already writes that way.
- Write as this writer writes: same language (including any mixing), register, person, tense, terminology and punctuation style, such as full-width punctuation in Chinese - and from the writer's side: in a letter, what they would say to the recipient, never the recipient's reply. In verse, keep each line about as long as the lines around it and don't repeat their words. After a finished sentence, what you write is a new sentence and starts like one, with a capital letter where the script has them.
- Stay inside the block: in a list item write only the rest of that one item, in a heading only the heading, in a table cell only the cell, in a code block only code in that language and indentation. Never add a line break (except inside code), a list marker or markdown syntax such as backticks or asterisks - outside code, write plain words.
- Where after-text exists, lead into it without repeating any of it.
- If nothing worthwhile can be added, return nothing.
Don't wrap your text in quotation marks or code fences, but do close a quotation the writer opened when its sentence ends. No explanations, notes or comments, and no internal or system XML tags: only the words to insert.";

pub(super) const COMPLETION_LENGTH_SHORT: &str = "Length: only what the text makes near-certain - usually the rest of the current clause or sentence, about 3 to 12 words, or 5 to 20 CJK characters; in a list item, table cell, heading or line of verse, just enough to finish it, about as long as its neighbours. Stop where the next words would be the writer's own choice.";

pub(super) const COMPLETION_LENGTH_LONG: &str = "The writer asked for a continuation: carry the current paragraph on by two to four sentences - roughly 40 to 90 words, or 60 to 160 CJK characters - moving it forward with what the text already supports. Stay in this paragraph: no new paragraph, heading or list.";

/// What the frontend knows about the cursor beyond the raw text around it
/// (ghost-text-plugin.ts's completionHints). Mirrors CompletionHints in
/// platform/ipc.ts.
#[derive(Deserialize, Default, Clone)]
pub struct CompletionHints {
    #[serde(default)]
    pub(crate) title: Option<String>,
    #[serde(default)]
    pub(crate) section: Vec<String>,
    #[serde(default)]
    pub(crate) block: Option<String>,
    #[serde(default)]
    pub(crate) length: Option<String>,
    /// How many alternative continuations to return (manual trigger only),
    /// separated by CANDIDATE_SEPARATOR lines.
    #[serde(default)]
    pub(crate) candidates: Option<u8>,
    /// The prose of the context: its text without code blocks, diagram
    /// and math source - what the language is read from.
    #[serde(default)]
    pub(crate) prose: Option<String>,
    /// The app's UI language (src/i18n/langs.ts), the fallback when the
    /// prose is too short to tell its language.
    #[serde(default, rename = "uiLanguage")]
    pub(crate) ui_language: Option<String>,
}

/// The line between alternative continuations in one response.
pub(crate) const CANDIDATE_SEPARATOR: &str = "<<<>>>";

/// The language the completion is written in, and whether it was read from
/// the prose (true) or is the app's (false): the prose's when it tells
/// (rules::detect), else the one its script alone gives - unless that is
/// Chinese in a Chinese app, whose script variant then decides - else the
/// UI language. None in a code block, or with neither prose nor UI
/// language (the live eval's bare cases).
pub(crate) fn completion_language(
    before: &str,
    after: &str,
    hints: &CompletionHints,
) -> Option<(&'static str, bool)> {
    use crate::ai::rules::detect::{self, Lang};
    if hints.block.as_deref() == Some(CODE_BLOCK_HINT) {
        return None;
    }
    let prose = hints
        .prose
        .clone()
        .unwrap_or_else(|| format!("{before}\n\n{after}"));
    let ui = hints.ui_language.as_deref().and_then(|code| {
        crate::ai::ui_language::UI_LANGUAGES
            .iter()
            .find(|l| l.code == code)
    });
    let name = |lang: Lang| {
        let code = lang.ui_code();
        crate::ai::ui_language::UI_LANGUAGES
            .iter()
            .find(|l| l.code == code)
            .map(|l| l.english)
    };
    if let Some(lang) = detect::detect(&prose) {
        return name(lang).map(|n| (n, true));
    }
    if let Some(lang) = detect::guess(&prose) {
        let chinese_ui = ui.is_some_and(|l| l.code == "zh" || l.code == "zh-Hant");
        if !(lang.is_chinese() && chinese_ui) {
            return name(lang).map(|n| (n, true));
        }
    }
    ui.map(|l| (l.english, false))
}

/// The completion request's user turn: the optional where-am-I tags, then
/// the text split at the cursor, with the word the cursor is in or right
/// after (word_at_cursor) in a tag of its own. No whitespace between the
/// cursor tags and the text - the before-text must end exactly where the
/// typed word starts (or at the cursor) for "start right at the last
/// character" to mean anything.
pub(super) fn completion_user_text(before: &str, after: &str, hints: &CompletionHints) -> String {
    let mut text = String::new();
    if let Some(title) = hints.title.as_deref().filter(|t| !t.trim().is_empty()) {
        text.push_str(&format!("<document-title>{title}</document-title>\n"));
    }
    if !hints.section.is_empty() {
        text.push_str(&format!(
            "<section>{}</section>\n",
            hints.section.join(" > ")
        ));
    }
    if let Some(block) = hints.block.as_deref().filter(|b| !b.trim().is_empty()) {
        text.push_str(&format!("<block>{block}</block>\n"));
    }
    match word_at_cursor(before) {
        Some(word) => text.push_str(&format!(
            "<text-before-cursor>{}</text-before-cursor>\n<word-at-cursor>{word}</word-at-cursor>\n<text-after-cursor>{after}</text-after-cursor>",
            &before[..before.len() - word.len()]
        )),
        None => match clause_at_cursor(before) {
            Some(clause) => text.push_str(&format!(
                "<text-before-cursor>{}</text-before-cursor>\n<clause-at-cursor>{clause}</clause-at-cursor>\n<text-after-cursor>{after}</text-after-cursor>",
                &before[..before.len() - clause.len()]
            )),
            None => text.push_str(&format!(
                "<text-before-cursor>{before}</text-before-cursor>\n<text-after-cursor>{after}</text-after-cursor>"
            )),
        },
    }
    text
}

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

#[tauri::command]
// Nine arguments at the IPC boundary, each a separate optional input from
// the frontend; bundling them would only move the same list into a struct.
#[allow(clippy::too_many_arguments)]
pub async fn ai_complete(
    app: AppHandle,
    provider: String,
    before: String,
    after: String,
    style: Option<String>,
    model: Option<String>,
    hints: Option<CompletionHints>,
    doc_path: Option<String>,
    workspace_root: Option<String>,
) -> Result<String, String> {
    crate::ai::ensure_on(&app)?;
    let hints = hints.unwrap_or_default();
    let (mut instructions, user_text) =
        completion_prompt(&before, &after, &hints, style.as_deref());
    // The project's style profile and the library entries the surrounding
    // text mentions - the same writing context the agent gets, so a
    // continuation uses the right names and the author's voice.
    let workspace = cached_workspace(&app, doc_path, workspace_root);
    add_writing_context(&mut instructions, &workspace, &before, &after);
    let raw = call(&app, &provider, instructions, user_text, model.as_deref()).await?;
    Ok(finish_suggestion(&before, &after, &raw, &hints))
}

/// The block hint ghost-text-plugin.ts sends for a code block - the one
/// block where a completion may run over several lines.
pub(crate) const CODE_BLOCK_HINT: &str = "code block";

/// Appends the project's style profile and the library entries the text
/// around the cursor mentions to the completion instructions - shared with
/// the live eval, so a completion under a style profile is measured exactly
/// as it is sent. The profile comes last in the prompt, so the output rule
/// is said once more after it: placed before it, Haiku (thinking off)
/// restated the profile's rules in the suggestion itself. And a profile's
/// sentence-length limit counts the whole sentence, of which the writer
/// may already have typed most - the live eval saw a 32-character sentence
/// under a 20-character limit.
pub(crate) fn add_writing_context(
    instructions: &mut String,
    workspace: &crate::ai::workspace::AgentWorkspace,
    before: &str,
    after: &str,
) {
    let mentioned =
        crate::ai::project::relevant_library(&workspace.library, &format!("{before}\n{after}"));
    if let Some(section) =
        crate::ai::project::writing_context_section(workspace.style.as_deref(), &mentioned)
    {
        instructions.push_str("\n\n");
        instructions.push_str(&section);
        instructions.push_str("\n\n");
        if workspace.style.is_some() {
            instructions.push_str("Write the way the style profile describes. A limit on sentence length counts the whole sentence, including the writer's part before the cursor - end the sentence early if that part is already long. ");
        }
        instructions.push_str("Output only the words to insert.");
    }
}

/// Scripts written without spaces between words: ideographs, kana and
/// full-width forms, and Thai, Lao, Tibetan, Myanmar and Khmer. Hangul is
/// not among them - Korean spaces its words.
pub(super) fn is_unspaced_script(c: char) -> bool {
    matches!(c,
        '\u{0e00}'..='\u{109f}'
        | '\u{1780}'..='\u{17ff}'
        | '\u{2e80}'..='\u{9fff}'
        | '\u{f900}'..='\u{faff}'
        | '\u{ff00}'..='\u{ffef}'
        | '\u{20000}'..='\u{3134f}')
}

pub(super) fn is_word_char(c: char) -> bool {
    c.is_alphanumeric() && !is_unspaced_script(c)
}

/// What holds letters together in one written word: "don't", "C'est",
/// "well-known", "3.5", "total_count".
pub(super) const WORD_JOINERS: [char; 5] = ['\'', '\u{2019}', '-', '.', '_'];

pub(super) fn is_apostrophe(c: char) -> bool {
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
pub(super) fn echoed_len(before: &str, text: &str) -> usize {
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
pub(super) fn drop_doubled_lead<'a>(before: &str, text: &'a str) -> &'a str {
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
pub(super) fn used_as_whole_word(text: &str, word: &str) -> bool {
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
pub(super) fn clean_reply(before: &str, after: &str, text: &str, in_code: bool) -> String {
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
pub(super) fn invents_figures(before: &str, after: &str, text: &str) -> bool {
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
pub(super) fn unwrap_quotes(text: &str) -> &str {
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
pub(super) fn first_clause(text: &str) -> String {
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
pub(super) fn first_sentence(text: &str) -> String {
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

/// The workspace for a completion, re-read at most every few seconds:
/// completions fire on every typing pause, and the style profile and
/// library only change when the user edits those files. One entry - typing
/// happens in one document at a time.
pub(super) fn cached_workspace(
    app: &AppHandle,
    doc_path: Option<String>,
    workspace_root: Option<String>,
) -> crate::ai::workspace::AgentWorkspace {
    use crate::ai::workspace::AgentWorkspace;
    use std::sync::Mutex;
    use std::time::{Duration, Instant};
    type Key = (Option<String>, Option<String>);
    static CACHE: Mutex<Option<(Key, Instant, AgentWorkspace)>> = Mutex::new(None);
    let key = (doc_path, workspace_root);
    let mut cache = CACHE.lock().unwrap();
    if let Some((cached_key, at, ws)) = cache.as_ref() {
        if *cached_key == key && at.elapsed() < Duration::from_secs(10) {
            return ws.clone();
        }
    }
    let ws = crate::ai::workspace::load(app, key.0.as_deref(), key.1.as_deref());
    *cache = Some((key, Instant::now(), ws.clone()));
    ws
}

/// The completion request as (system instructions, user turn) - shared by
/// the command and the live eval (live_eval.rs), so what the eval measures
/// is exactly what the app sends.
pub(crate) fn completion_prompt(
    before: &str,
    after: &str,
    hints: &CompletionHints,
    style: Option<&str>,
) -> (String, String) {
    let user_text = completion_user_text(before, after, hints);
    let length = match hints.length.as_deref() {
        Some("long") => COMPLETION_LENGTH_LONG,
        _ => COMPLETION_LENGTH_SHORT,
    };
    let mut instructions = format!("{COMPLETION_INSTRUCTIONS}\n\n{length}");
    match completion_language(before, after, hints) {
        Some((language, true)) => instructions.push_str(&format!(
            "\n\nLanguage: the writer's prose here is in {language}, so write in {language} (terms they mix in from other languages stay as they are). Code and diagram source in the text are not prose and don't change the language."
        )),
        Some((language, false)) => instructions.push_str(&format!(
            "\n\nLanguage: the text around the cursor has too little prose to tell its language (code and diagram source are not prose), so write in {language}, the language of the writer's app."
        )),
        None => {}
    }
    // The tone preset the user picked in Settings rides along after the base
    // contract. It decides the register - picking "Formal" means formal even
    // where the draft is plainer, which "write as this writer writes" used
    // to win in short completions while long ones overshot - but it can't
    // override the format, length and no-invention rules.
    if let Some(style) = style.map(str::trim).filter(|s| !s.is_empty()) {
        instructions.push_str(&format!(
            "\n\nTone the user chose in Settings: {style} It sets the register of your text in place of the writer's own; every other rule above still applies."
        ));
    }
    // One request for all alternatives: cheaper than N calls, and the model
    // can make them genuinely different rather than N near-copies. The
    // length is repeated per alternative: said once, the model shortened
    // each to a single sentence.
    if let Some(n) = hints.candidates.filter(|n| *n > 1) {
        instructions.push_str(&format!(
            "\n\nWrite {n} alternative continuations that take the text in clearly different directions (different next point, angle or wording) - each one a full continuation of the length above, following every rule above. Output them one after another, separated by a line containing only {CANDIDATE_SEPARATOR}. Nothing else."
        ));
    }
    (instructions, user_text)
}
