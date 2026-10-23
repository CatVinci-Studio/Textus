//! Now and then, the memory tidied: what was remembered over many
//! exchanges, one at a time, gathers repeats ("Reply in English." three
//! ways), rules a later one overturned, and wordy entries. After an
//! exchange's own pass, once enough has been added since the last tidy -
//! or a week has gone by - one more small request sees every memory and
//! answers with merges and removals, made by the same writer: a removed
//! memory goes to Recently forgotten, to bring back from the Memory tab.

use super::*;
use std::time::{SystemTime, UNIX_EPOCH};

/// No tidy below this many memories: too few to repeat each other.
const TIDY_FROM: usize = 8;
/// Memories added since the last tidy that call for another.
const TIDY_AFTER_ADDED: usize = 6;
/// Or this long since the last, when something changed.
const TIDY_AFTER_SECS: u64 = 7 * 24 * 60 * 60;
/// When the last tidy was, in the memory folder.
const MARKER: &str = ".tidied.json";

const TIDY_INSTRUCTIONS: &str = r#"You keep the memory of Textus AI, a writing assistant, tidy. Below is every memory it has, each with its id, scope and kind. Answer with the changes that tidy it, as JSON only.

- Repeats: memories that say the same thing (in other words, or one inside another) become one - update the clearest with the whole of what they say together, and forget the others "into" it.
- Overturned: when a newer memory (lower in its list) contradicts an older one about the same thing, forget the older "into" the newer - unless the newer says from where it holds ("From chapter 4 on…"); then both stay.
- Narrowed: a newer memory that makes an exception to an older one ("Use 您 in letters to clients" after "Write 你, never 您") overturns nothing - keep both, or update the older into one memory that says the rule and its exception; never lose the exception.
- Wordy: a memory that takes many words to say one thing may be updated shorter, saying exactly the same.
- Nothing else: never change what a memory means, never move one between scopes, never merge a personal memory with a project one, never add one. Most memories need nothing.

Write each update in the language the memory is written in.

Answer with exactly this JSON and nothing else:
{"changes": [{"op": "update" | "forget", "id": "<the memory's id>", "kind": "<its kind>", "scope": "<its scope>", "text": "<for update: the memory as it should read>", "into": "<for forget: the id of the memory that now says it, or overturns it>"}]}
- {"changes": []} when it is tidy already."#;

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or_default()
}

/// Where the marker is kept: the personal memory folder, else the
/// project's.
fn marker_path(dirs: &MemoryDirs) -> Option<PathBuf> {
    dirs.folder(Scope::Personal, MEMORY_FOLDER)
        .or_else(|| dirs.folder(Scope::Project, MEMORY_FOLDER))
        .map(|dir| dir.join(MARKER))
}

/// The last tidy: when (seconds) and how many memories there were after it.
fn last_tidy(dirs: &MemoryDirs) -> Option<(u64, usize)> {
    let text = std::fs::read_to_string(marker_path(dirs)?).ok()?;
    let value: serde_json::Value = serde_json::from_str(&text).ok()?;
    Some((value["at"].as_u64()?, value["count"].as_u64()? as usize))
}

fn mark_tidied(dirs: &MemoryDirs, count: usize, at: u64) {
    if let Some(path) = marker_path(dirs) {
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(
            path,
            serde_json::json!({ "at": at, "count": count }).to_string(),
        );
    }
}

/// Whether `count` memories call for a tidy now, given the last one.
pub(crate) fn tidy_due(count: usize, last: Option<(u64, usize)>, now: u64) -> bool {
    if count < TIDY_FROM {
        return false;
    }
    match last {
        None => true,
        Some((at, then)) => {
            count >= then + TIDY_AFTER_ADDED
                || (now.saturating_sub(at) >= TIDY_AFTER_SECS && count != then)
        }
    }
}

/// What the tidy is shown: every memory, by scope, oldest first.
fn tidy_input(memories: &Memories) -> String {
    let mut items: Vec<&Memory> = memories.items.iter().collect();
    items.sort_by(|a, b| {
        (a.scope.as_str(), &a.remembered.updated).cmp(&(b.scope.as_str(), &b.remembered.updated))
    });
    items
        .iter()
        .map(|m| {
            format!(
                "- [{}] ({}, {}) {}",
                m.id,
                m.scope.as_str(),
                m.kind.as_str(),
                m.text
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// The tidy's changes: only updates and removals of memories it was
/// shown - never an addition, never a library entry. A removal names the
/// memory it goes into, which stays: one updated in the same answer (a
/// merge), or a newer one (it overturns the older) - so a newer memory,
/// an exception to an older rule, is never lost to the rule.
fn tidy_changes(answer: &str, memories: &Memories) -> Vec<pass::Change> {
    let changes = parse_changes(answer);
    let shown = |id: &str| memories.items.iter().find(|m| m.id == id);
    let updated: Vec<&str> = changes
        .iter()
        .filter(|c| c.op() == "update")
        .filter_map(|c| c.id())
        .collect();
    // A removal into a memory of its own scope: merged into one updated
    // here, or overturned by a newer one.
    let fits = |c: &pass::Change| -> bool {
        let (Some(me), Some(into)) = (c.id().and_then(shown), c.merged_into().and_then(shown))
        else {
            return false;
        };
        into.id != me.id
            && into.scope == me.scope
            && (updated.contains(&into.id.as_str())
                || into.remembered.updated > me.remembered.updated)
    };
    let fitting: Vec<&pass::Change> = changes
        .iter()
        .filter(|c| c.op() == "forget" && fits(c))
        .collect();
    let gone: Vec<&str> = fitting.iter().filter_map(|c| c.id()).collect();
    // ...and that memory stays.
    let forgets = fitting
        .into_iter()
        .filter(|c| c.merged_into().is_some_and(|into| !gone.contains(&into)));
    let updates = changes.iter().filter(|c| {
        c.op() == "update"
            && c.id()
                .is_some_and(|id| shown(id).is_some() && !gone.contains(&id))
    });
    updates.chain(forgets).cloned().collect()
}

/// A tidy, when one is due: asked through `call`, its changes made, the
/// marker moved on. Nothing when none is due.
pub async fn tidy_if_due<F, Fut>(
    dirs: &MemoryDirs,
    source: &Source,
    call: F,
) -> Result<Vec<Remembering>, String>
where
    F: Fn(String, String) -> Fut,
    Fut: std::future::Future<Output = Result<String, String>>,
{
    let memories = dirs.load();
    let at = now_secs();
    if !tidy_due(memories.items.len(), last_tidy(dirs), at) {
        return Ok(Vec::new());
    }
    let answer = call(TIDY_INSTRUCTIONS.to_string(), tidy_input(&memories)).await?;
    let made = dirs.apply_changes(tidy_changes(&answer, &memories), source, &now());
    mark_tidied(dirs, dirs.load().items.len(), at);
    Ok(made)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_tidy_is_due_once_enough_was_added_or_a_week_went_by() {
        let day = 24 * 60 * 60;
        assert!(!tidy_due(5, None, 0));
        assert!(tidy_due(8, None, 0));
        assert!(!tidy_due(10, Some((0, 8)), day));
        assert!(tidy_due(14, Some((0, 8)), day));
        assert!(tidy_due(9, Some((0, 8)), 8 * day));
        // A week on with nothing new: nothing to tidy.
        assert!(!tidy_due(8, Some((0, 8)), 8 * day));
    }

    #[test]
    fn a_tidy_only_updates_and_forgets_what_it_was_shown() {
        let dir = tempfile::tempdir().unwrap();
        let dirs = MemoryDirs::new(Some(dir.path()), None);
        let source = Source::default();
        for text in [
            "Reply in English.",
            "Always answer in English.",
            "Use short sentences.",
        ] {
            dirs.remember(
                RememberArgs {
                    kind: "preference".into(),
                    scope: Some("personal".into()),
                    text: text.into(),
                    ..RememberArgs::default()
                },
                &source,
                &now(),
            )
            .unwrap();
        }
        // Remembered a day apart, the first oldest.
        let texts = [
            "Reply in English.",
            "Always answer in English.",
            "Use short sentences.",
        ];
        for m in dirs.load().items {
            let day = texts.iter().position(|t| *t == m.text).unwrap() + 1;
            let file = std::fs::read_to_string(&m.file).unwrap();
            let dated = file
                .lines()
                .map(|l| {
                    if l.starts_with("updated:") {
                        format!("updated: 2026-01-0{day}T00:00:00Z")
                    } else {
                        l.to_string()
                    }
                })
                .collect::<Vec<_>>()
                .join("\n");
            std::fs::write(&m.file, dated).unwrap();
        }
        let memories = dirs.load();
        let mut by_age: Vec<&Memory> = memories.items.iter().collect();
        by_age.sort_by(|a, b| a.remembered.updated.cmp(&b.remembered.updated));
        let ids: Vec<String> = by_age.iter().rev().map(|m| m.id.clone()).collect();
        let (newest, oldest) = (&ids[0], &ids[2]);
        assert!(
            by_age[0].remembered.updated < by_age[2].remembered.updated,
            "{:?}",
            by_age
                .iter()
                .map(|m| &m.remembered.updated)
                .collect::<Vec<_>>()
        );
        let answer = format!(
            r#"{{"changes": [{{"op": "forget", "id": "{oldest}", "into": "{newest}"}}, {{"op": "forget", "id": "{newest}", "into": "{}"}}, {{"op": "add", "kind": "fact", "text": "New."}}, {{"op": "forget", "id": "personal/memory/made-up", "into": "{newest}"}}]}}"#,
            ids[1]
        );
        let changes = tidy_changes(&answer, &memories);
        // The older into the newer: kept. The newest into an older one it
        // isn't merged with: refused. An addition, a made-up id: refused.
        assert_eq!(changes.len(), 1, "{changes:?}");
        assert_eq!(changes[0].id(), Some(oldest.as_str()));
        // Into one updated in the same answer, a merge: any age.
        let merge = format!(
            r#"{{"changes": [{{"op": "update", "id": "{oldest}", "text": "Reply in English."}}, {{"op": "forget", "id": "{newest}", "into": "{oldest}"}}]}}"#
        );
        assert_eq!(tidy_changes(&merge, &memories).len(), 2);
        let input = tidy_input(&memories);
        assert!(input.contains("Use short sentences."), "{input}");
    }

    #[test]
    fn the_marker_says_when_and_how_many() {
        let dir = tempfile::tempdir().unwrap();
        let dirs = MemoryDirs::new(Some(dir.path()), None);
        assert_eq!(last_tidy(&dirs), None);
        mark_tidied(&dirs, 9, 1_000);
        assert_eq!(last_tidy(&dirs), Some((1_000, 9)));
    }
}
