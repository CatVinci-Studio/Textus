//! Text and pictures proposed and not decided yet - this request's and
//! earlier ones' - that a new picture may stand next to or go into.

use super::*;

/// generate_image's actions: the insertions, and `replace` - a picture
/// already in the document, for one that redoes it. A picture for new text
/// is written into that text instead (inline).
pub(crate) const IMAGE_ACTIONS: [&str; 5] = [
    "insert_after",
    "insert_before",
    "insert_at_cursor",
    "append",
    "replace",
];

/// The src a picture being made has in a proposal's Markdown, until it is
/// saved. Mirrors `generatedImageSrc` in src/ai/revision/generated-images.ts.
pub(crate) fn placeholder_src(id: &str) -> String {
    format!("textus-generated:{id}")
}

/// What a picture may stand next to besides the document: the text of
/// proposals not decided yet - this request's own (ProposalLedger), and an
/// earlier request's the user hasn't accepted or rejected - where the
/// frontend puts the picture into that proposal.
pub struct ProposedText<'a> {
    pub this_request: &'a std::sync::Mutex<ProposalLedger>,
    pub undecided: &'a [UndecidedEdit],
}

impl ProposedText<'_> {
    /// Whether `anchor` is quoted from exactly one of them.
    pub(crate) fn quotes(&self, anchor: &str) -> bool {
        let ledger = self.this_request.lock().unwrap_or_else(|e| e.into_inner());
        let found: Vec<&String> = ledger
            .texts()
            .iter()
            .chain(self.undecided.iter().map(|edit| &edit.text))
            .filter(|text| text.contains(anchor))
            .collect();
        found.len() == 1 && found[0].matches(anchor).count() == 1
    }
}

/// A propose_edit from an earlier request the user hasn't decided on yet.
#[derive(Debug, Clone, PartialEq)]
pub struct UndecidedEdit {
    /// The document text a replace rewrites, which the user now sees as
    /// `text`; empty for any other action.
    pub replaced: String,
    /// Its new text.
    pub text: String,
}

/// Each propose_edit in `history` the user hasn't decided on yet, as its
/// result's status note says (src/ai/revision/proposal-status.ts), reading
/// as the user sees it: a later edit that went into one (the "joined" note)
/// is made in its text. Without that, a third request quoting the joined
/// text was checked against the first version (live_eval::continuing).
pub fn undecided_edits(history: &[AgentTurn]) -> Vec<UndecidedEdit> {
    const UNDECIDED: &str = "has NOT yet accepted or rejected this proposed edit";
    const JOINED: &str = "this went into the proposed text it changes";
    let note = |call_id: &str| {
        history.iter().find_map(|t| match t {
            AgentTurn::ToolResult {
                call_id: id,
                output,
                ..
            } if id == call_id => Some(output.as_str()),
            _ => None,
        })
    };
    let mut edits: Vec<UndecidedEdit> = Vec::new();
    for turn in history {
        let AgentTurn::ToolCall {
            call_id,
            name,
            arguments,
            ..
        } = turn
        else {
            continue;
        };
        if name != "propose_edit" {
            continue;
        }
        let Ok(args) = serde_json::from_str::<Value>(arguments) else {
            continue;
        };
        let field = |key: &str| args.get(key).and_then(Value::as_str).unwrap_or("");
        let (action, anchor, text) = (field("action"), field("anchor"), field("text"));
        let note = note(call_id).unwrap_or("");
        if note.contains(UNDECIDED) && !text.is_empty() {
            edits.push(UndecidedEdit {
                replaced: if action == "replace" { anchor } else { "" }.to_string(),
                text: text.to_string(),
            });
        } else if note.contains(JOINED) {
            if let Some((edit, made)) = edits.iter_mut().find_map(|edit| {
                edited_text(&edit.text, action, anchor, text).map(|made| (edit, made))
            }) {
                edit.text = made;
            }
        }
    }
    edits
}

/// `text` with an edit quoted from it made in it - src/ai/revision/
/// joined-edit.ts's editedText. None when the anchor isn't there exactly
/// once or the action isn't an anchored edit.
pub fn edited_text(text: &str, action: &str, anchor: &str, add: &str) -> Option<String> {
    if anchor.is_empty() || text.matches(anchor).count() != 1 {
        return None;
    }
    let at = text.find(anchor)?;
    let (before, after) = (&text[..at], &text[at + anchor.len()..]);
    let paragraph = |t: &str| format!("\n\n{}", t.trim());
    Some(match action {
        "replace" => format!("{before}{add}{after}"),
        "delete" => format!("{before}{after}")
            .replace("\n\n\n\n", "\n\n")
            .trim()
            .to_string(),
        "insert_after" if add.contains("\n\n") || after.is_empty() || after.starts_with("\n\n") => {
            let end = after.find("\n\n").unwrap_or(after.len());
            format!(
                "{before}{anchor}{}{}{}",
                &after[..end],
                paragraph(add),
                &after[end..]
            )
        }
        "insert_after" => format!("{before}{anchor} {add}{after}"),
        "insert_before" => format!("{before}{add} {anchor}{after}"),
        _ => return None,
    })
}

/// The pictures earlier requests made that the user hasn't accepted or
/// rejected yet, by id: a rewrite of the text by one may carry it
/// (ProposalLedger's known pictures).
pub fn undecided_pictures(history: &[AgentTurn]) -> Vec<String> {
    const UNDECIDED: &str = "has NOT yet accepted or rejected this proposed edit";
    history
        .iter()
        .filter_map(|turn| match turn {
            AgentTurn::ToolCall {
                call_id,
                name,
                arguments,
                ..
            } if name == GENERATE_IMAGE_TOOL_NAME => {
                let open = history.iter().any(|t| {
                    matches!(t, AgentTurn::ToolResult { call_id: id, output, .. }
                        if id == call_id && output.contains(UNDECIDED))
                });
                let args: Value = serde_json::from_str(arguments).ok()?;
                let id = args.get("image")?.get("id")?.as_str()?;
                open.then(|| id.to_string())
            }
            _ => None,
        })
        .collect()
}

/// Whether `anchor` is the whole Markdown of one picture, `![alt](src)` -
/// or `<img ...>`, as a picture given a width is written - the only thing a
/// picture may replace.
pub(crate) fn is_picture_markdown(anchor: &str) -> bool {
    let anchor = anchor.trim();
    if let Some(tag) = anchor.strip_prefix("<img") {
        return tag.starts_with(char::is_whitespace)
            && tag.ends_with('>')
            && !tag[..tag.len() - 1].contains('>');
    }
    let Some(rest) = anchor.strip_prefix("![") else {
        return false;
    };
    let Some((alt, after)) = rest.split_once("](") else {
        return false;
    };
    !alt.contains(']') && after.ends_with(')') && !after[..after.len() - 1].contains(')')
}
