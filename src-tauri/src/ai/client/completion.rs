//! Inline completion: the prompt for the text around the caret, and the
//! reply cleaned to fit there.

use super::*;

mod cursor;
pub(crate) use cursor::*;
mod reply;
pub(crate) use reply::*;

// Continues from the cursor, not the document's end. The word at the cursor
// travels in its own tag for the model to write out, and is cut off again
// (fit_to_cursor): models never begin a reply with a space.
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

const COMPLETION_LENGTH_SHORT: &str = "Length: only what the text makes near-certain - usually the rest of the current clause or sentence, about 3 to 12 words, or 5 to 20 CJK characters; in a list item, table cell, heading or line of verse, just enough to finish it, about as long as its neighbours. Stop where the next words would be the writer's own choice.";

const COMPLETION_LENGTH_LONG: &str = "The writer asked for a continuation: carry the current paragraph on by two to four sentences - roughly 40 to 90 words, or 60 to 160 CJK characters - moving it forward with what the text already supports. Stay in this paragraph: no new paragraph, heading or list.";

/// What the frontend knows about the cursor beyond the raw text around it.
#[derive(Deserialize, Default, Clone)]
#[cfg_attr(test, derive(specta::Type))]
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
    /// The app's UI language, the fallback when the prose is too short to tell
    /// its language.
    #[serde(default, rename = "uiLanguage")]
    pub(crate) ui_language: Option<String>,
}

/// The line between alternative continuations in one response.
pub(crate) const CANDIDATE_SEPARATOR: &str = "<<<>>>";

/// The language the completion is written in, and whether it was read from
/// the prose (true) or is the UI's (false). None in a code block, or with
/// neither prose nor UI language.
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

/// The completion request's user turn: the optional where-am-I tags, then the
/// text split at the cursor. No whitespace between the cursor tags and the
/// text: the before-text must end exactly where the typed word starts.
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

/// ai_complete's inputs, the keys of `ai.complete`'s invoke, generated into
/// the bindings to type that call.
#[derive(Deserialize)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct CompletionRequest {
    provider: String,
    before: String,
    after: String,
    style: Option<String>,
    model: Option<String>,
    hints: Option<CompletionHints>,
    doc_path: Option<String>,
    workspace_root: Option<String>,
}

#[tauri::command]
pub async fn ai_complete(
    app: AppHandle,
    request: Args<CompletionRequest>,
) -> Result<String, String> {
    let Args(CompletionRequest {
        provider,
        before,
        after,
        style,
        model,
        hints,
        doc_path,
        workspace_root,
    }) = request;
    crate::ai::ensure_on(&app)?;
    let hints = hints.unwrap_or_default();
    let (mut instructions, user_text) =
        completion_prompt(&before, &after, &hints, style.as_deref());
    // The project's style profile and the library entries the text mentions,
    // as the agent gets them.
    let workspace = cached_workspace(&app, doc_path, workspace_root);
    add_writing_context(&mut instructions, &workspace, &before, &after);
    let raw = call(&app, &provider, instructions, user_text, model.as_deref()).await?;
    Ok(finish_suggestion(&before, &after, &raw, &hints))
}

/// The block hint the frontend sends for a code block, the one block where a
/// completion may run over several lines.
pub(crate) const CODE_BLOCK_HINT: &str = "code block";

/// Appends the style profile and the library entries the text mentions to the
/// completion instructions. The output rule is repeated after the profile, or
/// the model restated the profile's rules in the suggestion.
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

/// The workspace for a completion, re-read at most every few seconds:
/// completions fire on every typing pause. One entry: one document at a time.
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

/// The completion request as (system instructions, user turn), shared by the
/// command and the live eval so both send the same.
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
    // The tone preset the user picked decides the register, but can't override
    // the format, length and no-invention rules.
    if let Some(style) = style.map(str::trim).filter(|s| !s.is_empty()) {
        instructions.push_str(&format!(
            "\n\nTone the user chose in Settings: {style} It sets the register of your text in place of the writer's own; every other rule above still applies."
        ));
    }
    // One request for all alternatives: cheaper, and they come out genuinely
    // different. The length is repeated per alternative, or each got shortened.
    if let Some(n) = hints.candidates.filter(|n| *n > 1) {
        instructions.push_str(&format!(
            "\n\nWrite {n} alternative continuations that take the text in clearly different directions (different next point, angle or wording) - each one a full continuation of the length above, following every rule above. Output them one after another, separated by a line containing only {CANDIDATE_SEPARATOR}. Nothing else."
        ));
    }
    (instructions, user_text)
}
