//! A short title for an untitled document with no heading, proposed as its
//! file name in the Save dialog. One short request to the writing model;
//! the frontend (src/ai/doc-title.ts) falls back to the first line when it
//! fails or is slow.

const INSTRUCTIONS: &str = "You name a writer's document. Read the start of it and answer with one short title for it: at most 8 words, or 20 characters in Chinese or Japanese, in the language the document is written in. Plain text on one line: no quotes, no Markdown, no full stop at the end, no \"Title:\". If the text is too short or empty to tell what it is about, answer NONE.";

/// The start of a document says what it is about; the frontend sends no
/// more than this, and a longer excerpt is cut here too.
const LONGEST_EXCERPT: usize = 4000;

/// A title longer than this is a sentence, not a file name.
const LONGEST: usize = 60;

const QUOTES: [char; 12] = [
    '"', '\'', '“', '”', '‘', '’', '「', '」', '《', '》', '`', '*',
];
const TAIL: [char; 13] = [
    '.', '。', '!', '！', '?', '？', ',', '，', ';', '；', ':', '：', '…',
];

fn input(excerpt: &str) -> String {
    let excerpt = excerpt.trim();
    let excerpt = match excerpt.char_indices().nth(LONGEST_EXCERPT) {
        Some((at, _)) => &excerpt[..at],
        None => excerpt,
    };
    format!("The start of the document:\n\n{excerpt}\n\nIts title:")
}

/// The model's answer as a title, or None: NONE, nothing, or too long.
pub(crate) fn title(answer: &str) -> Option<String> {
    let line = answer.lines().map(str::trim).find(|l| !l.is_empty())?;
    let line = line.trim_start_matches(['#', '-', '*', '>']).trim();
    let line = match line.split_once(':') {
        Some((label, rest)) if label.trim().eq_ignore_ascii_case("title") => rest.trim(),
        _ => line,
    };
    // A full stop may sit inside the quotes or outside them.
    let line = line.trim_end_matches(TAIL).trim();
    let line = line.trim_matches(QUOTES).trim_end_matches(TAIL).trim();
    if line.is_empty() || line.eq_ignore_ascii_case("none") || line.chars().count() > LONGEST {
        return None;
    }
    Some(line.to_string())
}

/// A short title for a document from its first few thousand characters, or
/// None.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn suggest_doc_title(
    app: tauri::AppHandle,
    provider: String,
    model: Option<String>,
    excerpt: String,
) -> Result<Option<String>, String> {
    crate::ai::ensure_on(&app)?;
    if excerpt.trim().is_empty() {
        return Ok(None);
    }
    let answer = crate::ai::client::call(
        &app,
        &provider,
        INSTRUCTIONS.to_string(),
        input(&excerpt),
        model.as_deref(),
    )
    .await?;
    Ok(title(&answer))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_answer_is_one_short_title_or_nothing() {
        assert_eq!(title("春天的花园").as_deref(), Some("春天的花园"));
        assert_eq!(
            title("\n\"Notes on the Q3 budget.\"\n").as_deref(),
            Some("Notes on the Q3 budget")
        );
        assert_eq!(
            title("Title: Trip to Kyoto").as_deref(),
            Some("Trip to Kyoto")
        );
        assert_eq!(title("# 《旅行计划》。").as_deref(), Some("旅行计划"));
        assert_eq!(title("NONE"), None);
        assert_eq!(title("  "), None);
        assert_eq!(title(&"word ".repeat(20)), None);
    }

    #[test]
    fn only_the_start_of_a_long_document_is_sent() {
        let text = input(&format!("{}END", "a".repeat(LONGEST_EXCERPT)));
        assert!(!text.contains("END"));
        assert!(text.contains(&"a".repeat(100)));
    }
}
