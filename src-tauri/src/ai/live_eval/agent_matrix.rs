//! The agent matrix: every kind of request the chat gets - questions,
//! rewrites in eleven languages, edits inside each Markdown construct,
//! reviews, agent.md / style / library / skills / project files, multi-turn
//! follow-ups, the three modes and ambiguous asks - each run through the app's
//! real prompt, tools and loop, checked automatically and graded by the
//! judge.

use super::checks::{self, Caret, Lang, StructureExpect};
use super::completion_matrix::CompletionCase;
use super::docs::{lang_doc, para, LANG_DOCS, RICH_DOC, RICH_DOC_ZH, TASKS_DOC_JA};
use super::harness::{
    self, conversation_material, run_conversation, AgentSetup, Checks, Record, TurnOutcome,
    UserTurn,
};
use crate::ai::agent::AgentMode;
use crate::ai::workspace::{AgentSkill, AgentWorkspace};
use aicompat::providers::anthropic::AnthropicAuth;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::Arc;

#[derive(Clone, Copy, Default, PartialEq)]
pub enum EditExpect {
    /// At least one proposal, all of them applying cleanly.
    Required,
    /// No propose_edit call at all.
    Forbidden,
    /// Either is acceptable - the judge decides whether the choice was good.
    #[default]
    Optional,
}

type Custom = fn(&TurnOutcome) -> Result<(), String>;

/// A named check that may capture case data (the selected passage, a
/// sample's habits) - shows up under its own name in the record.
pub type Check = Arc<dyn Fn(&TurnOutcome) -> Result<(), String> + Send + Sync>;

/// A check on a generated style profile: (profile, the samples it was
/// learned from).
pub type ProfileCheck = Arc<dyn Fn(&str, &str) -> Result<(), String> + Send + Sync>;

/// A real workspace on disk, loaded through workspace::load_from exactly
/// as the app loads it: the global config folder (the app config dir's
/// `textus/`), the open document's path, and the panel's workspace override.
#[derive(Clone, Default)]
pub struct DiskWorkspace {
    pub global: Option<PathBuf>,
    pub doc_path: Option<PathBuf>,
    pub root_override: Option<PathBuf>,
    /// Folders whose files go into the record (the workspace as built).
    pub show: Vec<PathBuf>,
}

/// "Learn my style": the picked sample files, where the profile is
/// written (the project's .textus/style.md, read back by the workspace
/// load), and checks on the generated profile.
#[derive(Clone)]
pub struct LearnStyle {
    pub samples: Vec<PathBuf>,
    pub write_to: Option<PathBuf>,
    pub checks: Vec<(&'static str, ProfileCheck)>,
}

/// What one turn must do. Checked on that turn's own before/after.
#[derive(Clone, Default)]
pub struct Expect {
    pub edit: EditExpect,
    pub comments: Option<bool>,
    /// The changed span must lie inside this passage of the document.
    pub region: Option<String>,
    pub structure: StructureExpect,
    /// Links, math, footnote refs and code spans must all survive.
    pub keep_inline: bool,
    /// Language of the text the edit writes (default: the document's).
    pub edit_lang: Option<Lang>,
    pub doc_has: Vec<String>,
    pub doc_lacks: Vec<String>,
    /// The reply must mention at least one of these (case-insensitive).
    pub reply_any: Vec<String>,
    pub shorter: bool,
    pub longer: bool,
    pub tools: Vec<&'static str>,
    /// Tools that must NOT be called.
    pub no_tools: Vec<&'static str>,
    pub custom: Option<Custom>,
    pub named: Vec<(&'static str, Check)>,
}

impl Expect {
    pub fn check(
        mut self,
        name: &'static str,
        f: impl Fn(&TurnOutcome) -> Result<(), String> + Send + Sync + 'static,
    ) -> Self {
        self.named.push((name, Arc::new(f)));
        self
    }
    pub fn has(mut self, needles: &[&str]) -> Self {
        self.doc_has.extend(needles.iter().map(|s| s.to_string()));
        self
    }
    pub fn lacks(mut self, needles: &[&str]) -> Self {
        self.doc_lacks.extend(needles.iter().map(|s| s.to_string()));
        self
    }
    pub fn reply(mut self, any: &[&str]) -> Self {
        self.reply_any = any.iter().map(|s| s.to_string()).collect();
        self
    }
    pub fn shorter(mut self) -> Self {
        self.shorter = true;
        self
    }
    pub fn longer(mut self) -> Self {
        self.longer = true;
        self
    }
    pub fn tools(mut self, tools: &[&'static str]) -> Self {
        self.tools.extend(tools);
        self
    }
    pub fn without_tools(mut self, tools: &[&'static str]) -> Self {
        self.no_tools.extend(tools);
        self
    }
    pub fn comments(mut self) -> Self {
        self.comments = Some(true);
        self
    }
    pub fn keep_inline(mut self) -> Self {
        self.keep_inline = true;
        self
    }
}

pub struct AgentCase {
    pub id: String,
    /// The language the user writes in - the reply's language.
    pub lang: Lang,
    /// The document's language - edits stay in it unless told otherwise.
    pub doc_lang: Lang,
    pub doc: String,
    pub script: Vec<UserTurn>,
    pub expects: Vec<Expect>,
    pub mode: AgentMode,
    pub workspace: AgentWorkspace,
    /// When set, the workspace is loaded from these folders at run time
    /// instead of `workspace`.
    pub disk: Option<DiskWorkspace>,
    pub learn: Option<LearnStyle>,
    /// A completion sent after the conversation under the same workspace
    /// (its style profile), checked like a completion case.
    pub then_complete: Option<CompletionCase>,
    /// Task-specific expectations for the judge.
    pub rubric: String,
}

impl AgentCase {
    pub fn new(
        id: &str,
        lang: Lang,
        doc_lang: Lang,
        doc: &str,
        message: &str,
        expect: Expect,
        rubric: &str,
    ) -> AgentCase {
        AgentCase {
            id: id.to_string(),
            lang,
            doc_lang,
            doc: doc.to_string(),
            script: vec![UserTurn::new(message)],
            expects: vec![expect],
            mode: AgentMode::Write,
            workspace: AgentWorkspace::default(),
            disk: None,
            learn: None,
            then_complete: None,
            rubric: rubric.to_string(),
        }
    }
    pub fn mode(mut self, mode: AgentMode) -> Self {
        self.mode = mode;
        self
    }
    pub fn workspace(mut self, ws: AgentWorkspace) -> Self {
        self.workspace = ws;
        self
    }
    pub fn disk(mut self, disk: DiskWorkspace) -> Self {
        self.disk = Some(disk);
        self
    }
    pub fn learn(mut self, learn: LearnStyle) -> Self {
        self.learn = Some(learn);
        self
    }
    pub fn complete_after(mut self, case: CompletionCase) -> Self {
        self.then_complete = Some(case);
        self
    }
    pub fn caret(mut self, caret: Caret) -> Self {
        self.script[0].caret = caret;
        self
    }
    /// Quick Ask opened on `selected`: every message of the conversation
    /// goes out with the selection as it reads at send time (see
    /// UserTurn::follow_selection), in Write mode (Quick Ask's default).
    pub fn quick(mut self, selected: &str) -> Self {
        let start = self.doc.find(selected).expect("selection in document");
        self.script[0].caret = Caret {
            cursor: None,
            selection: Some((start, start + selected.len())),
        };
        for turn in &mut self.script {
            turn.follow_selection = true;
        }
        self.mode = AgentMode::Write;
        self
    }
    /// A follow-up message; `accept_previous` is what the user did with the
    /// previous turn's proposals.
    pub fn then(mut self, accept_previous: bool, message: &str, expect: Expect) -> Self {
        let follow = self.script[0].follow_selection;
        self.script.last_mut().unwrap().accept = accept_previous;
        let mut turn = UserTurn::new(message);
        turn.follow_selection = follow;
        self.script.push(turn);
        self.expects.push(expect);
        self
    }
    /// A case that only learns a style profile (no conversation).
    pub fn learn_only(id: &str, lang: Lang, learn: LearnStyle, rubric: &str) -> AgentCase {
        AgentCase {
            id: id.to_string(),
            lang,
            doc_lang: lang,
            doc: String::new(),
            script: Vec::new(),
            expects: Vec::new(),
            mode: AgentMode::Write,
            workspace: AgentWorkspace::default(),
            disk: None,
            learn: Some(learn),
            then_complete: None,
            rubric: rubric.to_string(),
        }
    }
}

pub fn s(v: &[&str]) -> Vec<String> {
    v.iter().map(|x| x.to_string()).collect()
}

pub fn edit_in(region: &str, structure: StructureExpect) -> Expect {
    Expect {
        edit: EditExpect::Required,
        region: Some(region.to_string()),
        structure,
        ..Expect::default()
    }
}

pub fn edit_anywhere() -> Expect {
    Expect {
        edit: EditExpect::Required,
        ..Expect::default()
    }
}

pub fn no_edit() -> Expect {
    Expect {
        edit: EditExpect::Forbidden,
        ..Expect::default()
    }
}

pub fn either() -> Expect {
    Expect::default()
}

/// Mirrors src/ai/chat/user-message.ts: the selection block, then the
/// message - plus where the selection sits, for replace_selection.
pub fn with_selection(doc: &str, selected: &str, message: &str) -> (String, Caret) {
    let start = doc.find(selected).expect("selection in document");
    (
        format!("{}\n\n{message}", harness::selected_text_block(selected)),
        Caret {
            cursor: None,
            selection: Some((start, start + selected.len())),
        },
    )
}

/// Mirrors user-message.ts's cursorBlock around doc-markdown.ts's
/// caretContext: up to 160 characters of the editor's plain text either
/// side, blocks separated by a newline.
pub fn with_cursor(doc: &str, at: usize, message: &str) -> (String, Caret) {
    let (before, after) = checks::cursor_context(doc, at, 160);
    (
        format!("<cursor>\n{before}⟦cursor⟧{after}\n</cursor>\n\n{message}"),
        Caret {
            cursor: Some(at),
            selection: None,
        },
    )
}

/// "/name rest" as the app sends it: the production expansion
/// (builtin::expand_message) - the skill's instructions, with any reference
/// packs it declares for the document's language, in a <skill> block, a
/// blank line, then the rest.
pub fn resolve_skill_message(
    message: &str,
    skills: &[AgentSkill],
    document: &str,
    ui_language: &str,
) -> String {
    crate::ai::builtin::expand_message(message, skills, document, ui_language)
}

/// All text the turn's accepted proposals wrote, concatenated.
pub fn proposed_text(o: &TurnOutcome) -> String {
    o.proposals
        .iter()
        .map(|p| p.text.as_str())
        .collect::<Vec<_>>()
        .join("\n")
}

/// The text an accepted edit put into the document (the changed span of
/// the result), or "" when nothing changed.
pub fn inserted(o: &TurnOutcome) -> String {
    if o.doc_after == o.doc_before {
        return String::new();
    }
    let (s, _, e2) = checks::changed_span(&o.doc_before, &o.doc_after);
    o.doc_after[s..e2].to_string()
}

const SHORTEN_RUBRIC: &str = "The user asked to tighten the Method paragraph. Expect exactly one edit, to that paragraph only, written in the document's language, clearly shorter, and keeping every fact: the whole year (January to December), attendance recorded at every session, a short monthly paper questionnaire about the club and how it was run. The reply should be a brief note in the language the user wrote in.";

const QUESTION_RUBRIC: &str = "The user asked a factual question about the document. Expect no edit. The answer must say 310 participants (up from 120) and that the top complaint was the library closing at 4 p.m. on Sundays, cutting the Sunday session short - in the language the user wrote in, briefly.";

fn language_cases() -> Vec<AgentCase> {
    let mut cases = Vec::new();
    for d in LANG_DOCS {
        let method = para(d.doc, 1);
        let mut shorten = edit_in(method, StructureExpect::Same);
        shorten.shorter = true;
        if d.lang == Lang::Mixed {
            shorten.doc_has = s(&["IPC", "Node.js", "CI"]);
        }
        cases.push(AgentCase::new(
            &format!("lang/{}/shorten", d.lang.code()),
            d.lang,
            d.lang,
            d.doc,
            d.shorten,
            shorten,
            if d.lang == Lang::Mixed {
                "The user asked to tighten the 过程 paragraph. Expect one edit to that paragraph only, in Chinese, clearly shorter, keeping every fact (two weeks sorting out IPC calls, rewriting Node.js-dependent modules as Rust commands, keeping the CI pipeline green on macOS, Windows and Linux, harder than expected) and keeping the English technical terms as the author wrote them. Brief reply in Chinese."
            } else {
                SHORTEN_RUBRIC
            },
        ));
        let mut question = no_edit();
        question.reply_any = s(&["310", "12"]);
        cases.push(AgentCase::new(
            &format!("lang/{}/question", d.lang.code()),
            d.lang,
            d.lang,
            d.doc,
            d.question,
            question,
            if d.lang == Lang::Mixed {
                "The user asked a factual question. Expect no edit. The answer must say the installer went from 180 MB to 12 MB and cold start from 2.1 s to 0.6 s, in Chinese, briefly."
            } else {
                QUESTION_RUBRIC
            },
        ));
    }

    // The request's language and the document's differ: reply in the
    // user's, write in the document's.
    let zh = lang_doc(Lang::ZhHans).doc;
    let en = lang_doc(Lang::En).doc;
    let ja = lang_doc(Lang::Ja).doc;
    let mut e = edit_in(para(zh, 1), StructureExpect::Same);
    e.shorter = true;
    cases.push(AgentCase::new("cross/en-asks-zh-doc/shorten", Lang::En, Lang::ZhHans, zh, "Make the Method paragraph more concise.", e, &format!("{SHORTEN_RUBRIC} Here the user wrote in English about a Chinese document: the edited paragraph must stay Chinese, the reply must be English.")));
    let mut e = edit_in(para(en, 2), StructureExpect::Same);
    e.reply_any = vec![];
    cases.push(AgentCase::new("cross/zh-asks-en-doc/formal", Lang::ZhHans, Lang::En, en, "把 Findings 这一段改得更正式一些。", e, "The user (writing in Chinese) asked to make the English Findings paragraph more formal. Expect one edit to that paragraph, still in English, more formal in register, every fact kept (120 to 310, closes 4 p.m. Sundays, Sunday session cut short). Reply briefly in Chinese."));
    let mut q = no_edit();
    q.reply_any = s(&["4", "Sunday"]);
    cases.push(AgentCase::new("cross/en-asks-ja-doc/question", Lang::En, Lang::Ja, ja, "What was the most common complaint?", q, "The user wrote in English about a Japanese document. Expect no edit and an English answer: the library closes at 4 p.m. on Sundays, so the Sunday session ends early."));

    // Translation: the edit is in the target language by request.
    let mut t = edit_in(para(en, 2), StructureExpect::Same);
    t.edit_lang = Some(Lang::Es);
    t.doc_has = s(&["120", "310"]);
    cases.push(AgentCase::new("translate/en-to-es-paragraph", Lang::En, Lang::En, en, "Translate the Findings paragraph into Spanish.", t, "Expect one edit replacing the Findings paragraph with an accurate, natural Spanish translation (numbers and the 4 p.m. Sunday closing kept). Reply in English, briefly."));
    let findings = para(zh, 2);
    let (message, caret) = with_selection(zh, findings, "翻译成英文");
    let mut t = edit_in(findings, StructureExpect::Same);
    t.edit_lang = Some(Lang::En);
    t.doc_has = s(&["120", "310"]);
    cases.push(AgentCase::new("translate/zh-selection-to-en", Lang::ZhHans, Lang::ZhHans, zh, &message, t, "The user selected the Chinese findings paragraph and asked to translate it into English. Expect one edit replacing exactly the selection with a natural English translation keeping every fact. Reply briefly in Chinese.").caret(caret));
    cases
}

fn structure_cases() -> Vec<AgentCase> {
    let d = RICH_DOC;
    let section = |start: &str, end: &str| -> String {
        let a = d.find(start).expect("section start");
        let b = a + d[a..].find(end).expect("section end") + end.len();
        d[a..b].to_string()
    };
    let table = checks::lines_between(d, "| Component", "| Offline queue");
    let tasks = section("* [x] Write", "large files");
    let design_para = section("The engine keeps", "wire format.");
    let lists = section("* Storage", "exponential backoff");
    let variance = section("$$\ns^2", "^2\n$$");
    let code = section("```python", "1)\n```");
    let mermaid = section("```mermaid", "Log store]\n```");
    let details = section("<details>", "</details>");
    // The alert marker as the editor writes it (`> [!NOTE]`) - what the
    // model sees in the app.
    let note = section("> [!NOTE]", "today.");
    let front = section("---\ntitle", "sync]\n---");
    let image = section("![Architecture", "architecture.png)");

    let mut cases = Vec::new();
    let mut e = edit_in(&table, StructureExpect::Same);
    e.named.push((
        "search index row is Done",
        Arc::new(|o: &TurnOutcome| {
            checks::row_cells_are(
                &o.doc_after,
                "Search index",
                &["Search index", "Tom", "Done"],
            )
        }),
    ));
    cases.push(AgentCase::new("md/table-cell", Lang::En, Lang::En, d, "Mark the search index as done in the status table.", e, "Expect one edit changing only the Status cell of the Search index row to Done, table formatting intact."));

    let mut e = edit_in(
        &table,
        StructureExpect::Delta(&[("tr", 1), ("td", 3), ("/", 4)]),
    );
    e.doc_has = s(&["Export pipeline", "Li"]);
    cases.push(AgentCase::new("md/table-add-row", Lang::En, Lang::En, d, "Add a row to the status table: the export pipeline, owned by Li, not started yet.", e, "Expect one new table row (Export pipeline | Li | Not started, or equivalent wording matching the table's style), placed in the table, columns aligned with the others; nothing else changed."));

    let mut e = edit_in(&code, StructureExpect::Same);
    e.doc_has = s(&["/ len(samples)"]);
    e.doc_lacks = s(&["len(samples) - 1)"]);
    cases.push(AgentCase::new("md/code-fix-bug", Lang::En, Lang::En, d, "The average_replay_time function has a bug - fix it.", e, "The bug: it divides by len(samples) - 1 instead of len(samples). Expect a minimal fix inside the python code block, fence and language tag kept, no unrelated rewrites (an empty-list guard is acceptable but not required). Reply names the bug in one or two sentences."));

    let mut e = edit_in(
        &tasks,
        StructureExpect::Delta(&[("task", -1), ("task:x", 1)]),
    );
    e.doc_has = s(&["* [x] Update the docs"]);
    cases.push(AgentCase::new(
        "md/task-check",
        Lang::En,
        Lang::En,
        d,
        "Check off \"Update the docs\".",
        e,
        "Expect the single task item turned into `* [x] Update the docs`, nothing else touched.",
    ));

    let mut e = edit_in(&lists, StructureExpect::Delta(&[("item", 1), ("/", 1)]));
    e.doc_has = s(&["Long polling"]);
    e.custom = Some(|o| {
        let after = &o.doc_after;
        let t = after.find("* Transport").ok_or("Transport item gone")?;
        let tail = &after[t..];
        let lp = tail
            .find("Long polling")
            .ok_or("new item not under Transport")?;
        let line_start = tail[..lp].rfind('\n').map_or(0, |i| i + 1);
        tail[line_start..lp]
            .starts_with("  * ")
            .then_some(())
            .ok_or_else(|| {
                format!(
                    "new item is not a `  * ` item under Transport (the list's own bullet): {:?}",
                    &tail[line_start..lp]
                )
            })
    });
    cases.push(AgentCase::new("md/nested-list-add", Lang::En, Lang::En, d, "Under Transport, add a sub-item: long polling as a fallback.", e, "Expect one new nested list item (indented two spaces, like its sibling) under Transport, nothing else changed."));

    let mut e = edit_in(&variance, StructureExpect::Same);
    e.custom = Some(|o| {
        let a = &o.doc_after;
        (a.contains("n-1") || a.contains("n - 1"))
            .then_some(())
            .ok_or_else(|| "no n-1 in the variance".to_string())
    });
    cases.push(AgentCase::new("md/math-fix", Lang::En, Lang::En, d, "The variance formula should be the unbiased sample variance. Fix it.", e, "Expect the second display-math block changed to divide by n-1 (\\frac{1}{n-1}), still a $$ block, the mean formula untouched."));

    let mut e = edit_in(
        &d[d.find("The engine keeps").unwrap()..],
        StructureExpect::Any,
    );
    e.custom = Some(|o| {
        let before = checks::skeleton(&o.doc_before);
        let after = checks::skeleton(&o.doc_after);
        let refs =
            |sk: &checks::Skeleton| sk.inline.keys().filter(|k| k.starts_with("fnref:")).count();
        let defs =
            |sk: &checks::Skeleton| sk.blocks.iter().filter(|b| b.starts_with("fndef:")).count();
        // A reference attaches to its word, as the author's "document[^1]"
        // does - not "snapshot [^2]".
        let detached = o.doc_after.matches(" [^").count() > o.doc_before.matches(" [^").count();
        if detached {
            Err("the new reference is detached by a space".into())
        } else if refs(&after) == refs(&before) + 1 && defs(&after) == defs(&before) + 1 {
            Ok(())
        } else {
            Err(format!(
                "footnotes {} refs/{} defs -> {}/{}",
                refs(&before),
                defs(&before),
                refs(&after),
                defs(&after)
            ))
        }
    });
    cases.push(AgentCase::new("md/footnote-add", Lang::En, Lang::En, d, "Add a footnote after \"last snapshot\" explaining that snapshots are created on the server.", e, "Expect a new footnote reference right after 'last snapshot' and a matching footnote definition (next to the existing [^1] definition at the end), with a label that doesn't collide with [^1]."));

    let mut e = edit_in(&note, StructureExpect::Same);
    e.shorter = true;
    e.doc_has = s(&["[!NOTE]"]);
    cases.push(AgentCase::new("md/alert-shorten", Lang::En, Lang::En, d, "Make the note at the top more concise.", e, "Expect the [!NOTE] alert kept as an alert (> [!NOTE] line and > prefixes), its sentence clearly shorter with the same meaning."));

    let mut e = edit_in(&design_para, StructureExpect::Same);
    e.doc_has = s(&["(https://example.com/spec/v2)"]);
    e.keep_inline = false;
    cases.push(AgentCase::new("md/link-change", Lang::En, Lang::En, d, "Point the protocol spec link to https://example.com/spec/v2 instead.", e, "Expect only the link target changed; the link text, the footnote reference and the $O(n)$ math in the same paragraph untouched."));

    let mut e = edit_in(&front, StructureExpect::Same);
    e.doc_has = s(&["performance"]);
    cases.push(AgentCase::new("md/frontmatter", Lang::En, Lang::En, d, "Add performance to the tags in the front matter.", e, "Expect the YAML tags list to become [design, sync, performance] (or equivalent valid YAML), nothing else touched."));

    let mut e = edit_in(&details, StructureExpect::Same);
    e.doc_has = s(&["<summary>Why not use CRDTs?</summary>"]);
    cases.push(AgentCase::new("md/html-block", Lang::En, Lang::En, d, "Change the summary of the details block to \"Why not use CRDTs?\".", e, "Expect only the <summary> text changed, the raw HTML structure and the paragraph inside intact."));

    let mut e = edit_in(&mermaid, StructureExpect::Same);
    e.custom = Some(|o| {
        let a = &o.doc_after;
        let m = &a[a.find("```mermaid").ok_or("mermaid block gone")?..];
        let block = &m[..m[3..].find("```").map_or(m.len(), |i| i + 3)];
        (block.to_lowercase().contains("cache") && block.contains("flowchart LR"))
            .then_some(())
            .ok_or_else(|| format!("no cache node in {block:?}"))
    });
    cases.push(AgentCase::new("md/mermaid", Lang::En, Lang::En, d, "In the diagram, put a cache between the server and the log store.", e, "Expect the mermaid flowchart to route Server -> Cache -> Log store with valid mermaid syntax, the fence kept as ```mermaid."));

    let mut e = edit_in("## Design", StructureExpect::Same);
    e.doc_has = s(&["## Architecture"]);
    cases.push(AgentCase::new(
        "md/heading-rename",
        Lang::En,
        Lang::En,
        d,
        "Rename the Design section to Architecture.",
        e,
        "Expect only the heading text changed, still a level-2 heading.",
    ));

    let mut e = edit_in(&design_para, StructureExpect::Same);
    e.keep_inline = true;
    cases.push(AgentCase::new("md/rewrite-keeps-inline", Lang::En, Lang::En, d, "Rewrite the first paragraph of the Design section so a newcomer can follow it.", e, "Expect a clearer rewrite of that paragraph only, keeping the footnote reference [^1], the $O(n)$ inline math and the protocol spec link (same URL), with no facts added or lost."));

    let mut e = edit_in(&image, StructureExpect::Same);
    e.doc_has = s(&["(images/architecture.png)"]);
    cases.push(AgentCase::new("md/image-alt", Lang::En, Lang::En, d, "Give the architecture image a more descriptive alt text.", e, "Expect only the image's alt text changed to something descriptive and grounded in the document (client, server, log store), the path untouched."));

    let mut q = no_edit();
    q.reply_any = s(&["O(n)", "linear", "snapshot"]);
    cases.push(AgentCase::new("md/question", Lang::En, Lang::En, d, "What happens to the cost of opening a document as more operations pile up?", q, "Expect no edit; an accurate answer: it grows linearly with the operations since the last snapshot (O(n)), and snapshots every 500 operations bound it."));

    // Chinese and Japanese documents with the same kinds of in-place edits.
    let zt = RICH_DOC_ZH;
    let ztable = checks::lines_between(zt, "| 模块", "| 离线队列");
    let mut e = edit_in(&ztable, StructureExpect::Same);
    e.named.push((
        "search index row is 已完成",
        Arc::new(|o: &TurnOutcome| {
            checks::row_cells_are(&o.doc_after, "搜索索引", &["搜索索引", "阿汤", "已完成"])
        }),
    ));
    cases.push(AgentCase::new(
        "md/zh-table-cell",
        Lang::ZhHans,
        Lang::ZhHans,
        zt,
        "把状态表里“搜索索引”的状态改成已完成。",
        e,
        "Expect only that cell changed to 已完成; reply briefly in Chinese.",
    ));
    let zcode = &zt[zt.find("```js").unwrap()..zt.find("}\n```").unwrap() + 5];
    let mut e = edit_in(zcode, StructureExpect::Same);
    e.doc_has = s(&["i = 0"]);
    cases.push(AgentCase::new("md/zh-code-fix", Lang::ZhHans, Lang::ZhHans, zt, "averageReplayTime 算出来的平均值偏小，帮我修一下。", e, "The bug: the loop starts at i = 1 and skips the first sample. Expect a minimal fix inside the js block (start at 0, or use reduce/for-of), the Chinese comment kept; reply in Chinese naming the cause."));
    let ja_tasks = &TASKS_DOC_JA[TASKS_DOC_JA.find("* [x]").unwrap()
        ..TASKS_DOC_JA.find("見直す").unwrap() + "見直す".len()];
    let mut e = edit_in(
        ja_tasks,
        StructureExpect::Delta(&[("task", -1), ("task:x", 1)]),
    );
    e.doc_has = s(&["* [x] スクリーンショットを更新する"]);
    cases.push(AgentCase::new(
        "md/ja-task-check",
        Lang::Ja,
        Lang::Ja,
        TASKS_DOC_JA,
        "スクリーンショットの項目を完了にして。",
        e,
        "Expect that one task item checked, nothing else; reply briefly in Japanese.",
    ));
    cases
}

/// The interview notes the project-files case reads.
fn project_dir() -> String {
    let dir = std::env::temp_dir().join(format!("textus-eval-project-{}", std::process::id()));
    std::fs::create_dir_all(dir.join("notes")).unwrap();
    std::fs::write(
        dir.join("notes/interviews.md"),
        "# Interview notes\n\nJanuary sign-ups: 128 (the 120 in the draft left out walk-ins).\nDecember sign-ups: 307 after removing duplicates.\nSunday closing time came up in 41 of 60 questionnaires.\n",
    )
    .unwrap();
    std::fs::write(dir.join("report.md"), lang_doc(Lang::En).doc).unwrap();
    dir.to_string_lossy().into_owned()
}

fn behaviour_cases() -> Vec<AgentCase> {
    let en = lang_doc(Lang::En).doc;
    let zh = lang_doc(Lang::ZhHans).doc;
    let mut cases = Vec::new();

    let mut q = no_edit();
    q.reply_any = s(&["310"]);
    cases.push(AgentCase::new("task/summarize-in-chat", Lang::En, Lang::En, en, "Summarize this document in three bullet points.", q, "A summary request is a request for information: expect three accurate bullet points in the reply and NO edit to the document (the user didn't ask to put it in the document)."));

    let mut e = Expect {
        edit: EditExpect::Required,
        ..Expect::default()
    };
    // Judged on the text, not the changed span: a summary that starts
    // with "The " shares that prefix with the intro, which pushed the
    // minimal diff's start past it (a false failure in round 2's run1).
    // The whole intro paragraph marks where the summary must end: one
    // that opens with the intro's own first words ("The city library
    // started...") is still the summary (round 4, a false failure).
    e.custom = Some(|o| {
        let title = o.doc_before.lines().next().unwrap_or("");
        let intro = o
            .doc_before
            .lines()
            .skip(1)
            .find(|l| !l.trim().is_empty())
            .unwrap_or("");
        let head = o.doc_after.split(intro).next().unwrap_or("");
        (head.starts_with(title) && head[title.len()..].trim().len() > 40)
            .then_some(())
            .ok_or_else(|| {
                "summary not placed between the title and the first paragraph".to_string()
            })
    });
    cases.push(AgentCase::new("task/summary-into-doc", Lang::En, Lang::En, en, "Add a two-sentence summary at the top of the document, under the title.", e, "Expect one insertion right under the title: two accurate sentences (growth 120 to 310, Sunday 4 p.m. closing complaint, possibly the author visits), nothing else changed."));

    let mut e = edit_in(para(en, 2), StructureExpect::Same);
    e.longer = true;
    cases.push(AgentCase::new("task/expand", Lang::En, Lang::En, en, "Expand the Findings paragraph with a sentence on what the Sunday complaint means for staffing.", e, "Expect the Findings paragraph kept and one or two sentences added that reason from the Sunday 4 p.m. closing to staffing (e.g. extending Sunday hours needs staff cover), without inventing statistics."));

    let es = lang_doc(Lang::Es).doc;
    let e = edit_in(para(es, 3), StructureExpect::Same);
    cases.push(AgentCase::new("task/rewrite-formal-es", Lang::Es, Lang::Es, es, "Reescribe la última frase con un tono más formal.", e, "Expect the last sentence rewritten in a more formal Spanish register with the same meaning; reply briefly in Spanish."));

    let budget_doc = en.replace(
        " The most common complaint",
        " The club spent its whole budget of 2,000 dollars by October. The most common complaint",
    );
    let mut e = edit_in(para(&budget_doc, 2), StructureExpect::Same);
    e.doc_lacks = s(&["2,000"]);
    e.shorter = true;
    cases.push(AgentCase::new("task/delete-sentence", Lang::En, Lang::En, &budget_doc, "Delete the sentence about the budget.", e, "Expect exactly that sentence removed, the rest of the paragraph untouched and still reading smoothly."));

    let mut e = Expect {
        edit: EditExpect::Required,
        ..Expect::default()
    };
    e.custom = Some(|o| {
        let (s, _, _) = checks::changed_span(&o.doc_before, &o.doc_after);
        (s >= o.doc_before.find("Next year").unwrap())
            .then_some(())
            .ok_or_else(|| "continuation not at the end".to_string())
    });
    cases.push(AgentCase::new("task/continue", Lang::En, Lang::En, en, "Continue the document with one more short paragraph about next steps.", e, "Expect one new paragraph at the end of the document (append or insert after the last line), in the author's plain register, building on the author visits and the Sunday-hours complaint, without invented numbers."));

    let sentence = "The most common complaint was that the library closes at 4 p.m. on Sundays, which cuts the Sunday session short.";
    let (message, caret) = with_selection(en, sentence, "Make this sentence more vivid.");
    let e = edit_in(sentence, StructureExpect::Same);
    cases.push(AgentCase::new("task/replace-selection", Lang::En, Lang::En, en, &message, e, "Expect the selected sentence (only) rewritten more vividly, facts unchanged (4 p.m., Sundays, session cut short), no purple prose.").caret(caret));

    let at = en.find("\n\n## Findings").unwrap();
    let (message, caret) = with_cursor(
        en,
        at,
        "Write a transition sentence here that leads into the findings.",
    );
    let mut e = Expect {
        edit: EditExpect::Required,
        ..Expect::default()
    };
    e.custom = Some(|o| {
        let p = &o.proposals[0];
        (p.action == "insert_at_cursor" || p.action == "insert_after")
            .then_some(())
            .ok_or_else(|| format!("used {} instead of inserting at the cursor", p.action))
    });
    cases.push(AgentCase::new("task/insert-at-cursor-en", Lang::En, Lang::En, en, &message, e, "Expect one short transition sentence inserted at the cursor (end of the Method paragraph), leading into the findings, nothing else changed.").caret(caret));

    let at = zh.find("\n\n## 发现").unwrap();
    let (message, caret) = with_cursor(zh, at, "在这里补一句过渡，引出下一段。");
    let mut e = Expect {
        edit: EditExpect::Required,
        ..Expect::default()
    };
    e.custom = Some(|o| {
        let p = &o.proposals[0];
        (p.action == "insert_at_cursor" || p.action == "insert_after")
            .then_some(())
            .ok_or_else(|| format!("used {} instead of inserting at the cursor", p.action))
    });
    cases.push(AgentCase::new("task/insert-at-cursor-zh", Lang::ZhHans, Lang::ZhHans, zh, &message, e, "Expect one short Chinese transition sentence at the cursor (end of the 方法 paragraph) leading into the findings; reply in Chinese.").caret(caret));

    let mut e = edit_in(para(zh, 2), StructureExpect::Same);
    e.doc_has = s(&["（2024 年）"]);
    cases.push(AgentCase::new("task/insert-inside-sentence-zh", Lang::ZhHans, Lang::ZhHans, zh, "在“十二月的 310 人”后面补充“（2024 年）”。", e, "Expect the exact text （2024 年） inserted right after 十二月的 310 人 inside the sentence, no new paragraph."));

    let mut e = Expect {
        edit: EditExpect::Forbidden,
        comments: Some(true),
        ..Expect::default()
    };
    e.reply_any = vec![];
    cases.push(AgentCase::new("review/revise-mode-comments", Lang::En, Lang::En, en, "Review this draft and point out its weakest spots. Don't change anything yet.", e, "Expect add_comment calls pinned to specific passages (e.g. the wordy Method paragraph, the vague intro, the abrupt last line, missing context for the numbers), no edits, and a short summary reply."));
    let mut e = Expect {
        edit: EditExpect::Forbidden,
        comments: Some(true),
        ..Expect::default()
    };
    e.reply_any = vec![];
    cases.push(AgentCase::new("review/review-mode-zh", Lang::ZhHans, Lang::ZhHans, zh, "帮我看看这篇文章哪里写得不好，指出具体的段落。", e, "Review mode: expect comments pinned to specific passages in Chinese and a short Chinese summary, no edits.").mode(AgentMode::Review));

    let mut q = no_edit();
    q.reply_any = vec![];
    cases.push(AgentCase::new("ask/question-not-edit-en", Lang::En, Lang::En, en, "Is the Method paragraph too long?", q, "A yes/no question about the text: expect an answer (yes, it is wordy, with a specific reason or two) and NO edit. Offering to shorten it is fine."));
    let mut q = no_edit();
    q.reply_any = vec![];
    cases.push(AgentCase::new("ask/why-question-zh", Lang::ZhHans, Lang::ZhHans, zh, "我为什么要在“发现”里提到周日闭馆时间？", q, "A question about the author's intent: expect a short Chinese answer (it's the most common complaint and explains why Sunday sessions end early), NO edit."));

    // Ambiguity: either a reasonable, contained improvement or a question.
    let amb = Expect {
        custom: Some(|o| {
            if o.doc_after == o.doc_before {
                return Ok(());
            }
            let (s, e, _) = checks::changed_span(&o.doc_before, &o.doc_after);
            ((e - s) * 10 < o.doc_before.len() * 7)
                .then_some(())
                .ok_or_else(|| "rewrote most of the document for a vague request".to_string())
        }),
        ..Expect::default()
    };
    cases.push(AgentCase::new("ambiguous/make-it-better", Lang::En, Lang::En, en, "Make it better.", amb, "The request is vague. Good behaviour: either a short clarifying question, or a focused improvement of the obviously weakest part (the wordy Method paragraph) with a one-line explanation and an offer to do more. Bad: rewriting the whole document or changing facts."));
    let typo_doc = en.replace("which cuts the Sunday", "wich cuts the Sunday");
    let at = typo_doc.find("wich").unwrap() + 2;
    let (message, caret) = with_cursor(&typo_doc, at, "fix this");
    let mut e = edit_in(para(&typo_doc, 2), StructureExpect::Same);
    e.doc_has = s(&["which cuts the Sunday"]);
    cases.push(AgentCase::new("ambiguous/fix-this-at-cursor", Lang::En, Lang::En, &typo_doc, &message, e, "'fix this' with the cursor inside the misspelled word 'wich': expect the typo fixed to 'which' with a minimal edit, nothing else rewritten.").caret(caret));

    // Multi-turn follow-ups.
    let mut first = edit_in(para(zh, 1), StructureExpect::Same);
    first.shorter = true;
    let mut second = edit_in(para(zh, 2), StructureExpect::Same);
    second.shorter = true;
    second.doc_has = s(&["120", "310"]);
    cases.push(
        AgentCase::new("multi/zh-same-again", Lang::ZhHans, Lang::ZhHans, zh, "把“方法”这一段改得更简洁。", first, "Turn 1: tighten 方法. Turn 2 ('do the same to the next one') refers back: expect the 发现 paragraph tightened the same way, numbers kept, Chinese replies.")
            .then(true, "下一段也照这样处理。", second),
    );
    let mut first = edit_in(para(en, 1), StructureExpect::Same);
    first.shorter = true;
    let mut second = edit_in(para(en, 1), StructureExpect::Same);
    second.custom = Some(|o| {
        let p = o
            .proposals
            .iter()
            .map(|p| p.text.as_str())
            .collect::<String>();
        (p.contains("January") && p.contains("December") || p.contains("year"))
            .then_some(())
            .ok_or_else(|| "lost the time span on retry".to_string())
    });
    cases.push(
        AgentCase::new("multi/en-rejected-retry", Lang::En, Lang::En, en, "Make the Method paragraph more concise.", first, "Turn 1: tighten Method; the user REJECTS it. Turn 2: 'try again, but keep the January-to-December span explicit'. Expect a fresh proposal against the ORIGINAL paragraph (the rejected text is not in the document) that keeps the time span.")
            .then(false, "Try again, but keep the January-to-December span explicit.", second),
    );
    let mut first = no_edit();
    first.reply_any = s(&["Sunday", "4"]);
    let mut second = Expect {
        edit: EditExpect::Required,
        ..Expect::default()
    };
    second.custom = Some(|o| {
        let (s, _, _) = checks::changed_span(&o.doc_before, &o.doc_after);
        let added = &o.doc_after[s..];
        (s >= o.doc_before.find("Next year").unwrap() && added.to_lowercase().contains("sunday"))
            .then_some(())
            .ok_or_else(|| "the added sentence is not at the end or not about Sundays".to_string())
    });
    cases.push(
        AgentCase::new("multi/question-then-act", Lang::En, Lang::En, en, "What was the most common complaint?", first, "Turn 1 is a question (no edit). Turn 2 says 'add a sentence at the end proposing a fix for it' - 'it' is the Sunday closing: expect one sentence appended at the end proposing e.g. later Sunday hours.")
            .then(true, "Add a sentence at the end proposing a fix for it.", second),
    );

    cases.extend(workspace_cases());
    cases
}

fn workspace_cases() -> Vec<AgentCase> {
    let en = lang_doc(Lang::En).doc;
    let zh = lang_doc(Lang::ZhHans).doc;
    let mut cases = Vec::new();

    // agent.md overriding the reply language, plus a spelling convention.
    let us_doc = "# Studio notes\n\nWe organized a color workshop for the neighborhood center in May. Our favorite part was watching kids mix paint, and we realized the room needs better light.\n\nThe next workshop is in September.\n";
    let ws = AgentWorkspace {
        instructions: vec!["Always reply in English, whatever language the user writes in.\nUse British spelling in everything you write for the document.".into()],
        ..AgentWorkspace::default()
    };
    let mut e = edit_in(para(us_doc, 0), StructureExpect::Same);
    e.custom = Some(|o| {
        let text: String = o.proposals.iter().map(|p| p.text.to_lowercase()).collect();
        let american: Vec<&str> = [
            "organized",
            "color",
            "neighborhood",
            "center",
            "favorite",
            "realized",
        ]
        .into_iter()
        .filter(|w| text.split(|c: char| !c.is_alphabetic()).any(|t| t == *w))
        .collect();
        american
            .is_empty()
            .then_some(())
            .ok_or_else(|| format!("American spelling kept: {american:?}"))
    });
    cases.push(AgentCase::new("agentmd/reply-language-and-spelling", Lang::En, Lang::En, us_doc, "把第一段改得更生动一点。", e, "The writing instructions (agent.md) say: always reply in English, and use British spelling in document text. The user wrote in Chinese, so the reply must still be ENGLISH. Expect the first paragraph rewritten more vividly with British spellings (organised, colour, neighbourhood, centre, favourite, realised), facts kept.").workspace(ws));

    let ws = AgentWorkspace {
        instructions: vec!["面向读者时一律用“您”，不要用“你”。数字一律用阿拉伯数字。".into()],
        ..AgentWorkspace::default()
    };
    let mut e = Expect {
        edit: EditExpect::Required,
        ..Expect::default()
    };
    e.custom = Some(|o| {
        let text: String = o.proposals.iter().map(|p| p.text.clone()).collect();
        (!text.contains('你'))
            .then_some(())
            .ok_or_else(|| "used 你 despite the writing instructions".to_string())
    });
    cases.push(AgentCase::new("agentmd/zh-conventions", Lang::ZhHans, Lang::ZhHans, zh, "在文末加一段写给家长的邀请，欢迎他们带孩子来参加。", e, "Writing instructions (agent.md): address readers as 您 (never 你) and use Arabic numerals. Expect one new paragraph at the end inviting parents, following both conventions, consistent with the facts (weekend club, monthly author visits next year).").workspace(ws));

    // The style profile shapes what the agent writes.
    let ws = AgentWorkspace {
        style: Some("# Style profile\n\n## Sentences and rhythm\n- Short sentences, rarely over 14 words.\n- Present tense where possible.\n\n## Word choice\n- No adverbs ending in -ly.\n- Plain words over formal ones.\n\n## Never\n- Em dashes.\n- Rhetorical questions.".into()),
        ..AgentWorkspace::default()
    };
    let mut e = edit_in(para(en, 3), StructureExpect::Any);
    e.longer = true;
    e.custom = Some(|o| {
        let (s, _, e2) = checks::changed_span(&o.doc_before, &o.doc_after);
        let added = &o.doc_after[s..e2];
        let sentences: Vec<&str> = added
            .split(['.', '!', '?'])
            .filter(|x| x.split_whitespace().count() > 2)
            .collect();
        let avg = sentences
            .iter()
            .map(|x| x.split_whitespace().count())
            .sum::<usize>() as f64
            / sentences.len().max(1) as f64;
        let ly = added
            .split_whitespace()
            .filter(|w| w.trim_matches(|c: char| !c.is_alphabetic()).ends_with("ly") && w.len() > 4)
            .count();
        let mut problems = Vec::new();
        if avg > 16.0 {
            problems.push(format!("average sentence {avg:.1} words"));
        }
        if added.contains('—') {
            problems.push("em dash".to_string());
        }
        if ly > 1 {
            problems.push(format!("{ly} -ly adverbs"));
        }
        problems
            .is_empty()
            .then_some(())
            .ok_or_else(|| problems.join(", "))
    });
    cases.push(AgentCase::new("style/profile-followed", Lang::En, Lang::En, en, "Expand the last line into a short paragraph of four or five sentences about the author visits.", e, "A style profile asks for short sentences (≤14 words), present tense, no -ly adverbs, no em dashes, no rhetorical questions. Expect the last line expanded into 4-5 sentences that follow it, without inventing specific facts (names, dates) the document doesn't support.").workspace(ws));

    // Library: names and facts from .textus/library.
    let story = "# Chapter 3\n\nThe ferry was late again. Mira stood at the end of the dock with her notebook, counting the gulls out of habit.\n\nBehind her, the harbour office was already closing.\n";
    let ws = AgentWorkspace {
        library: vec![crate::ai::project::parse_library_entry(
            ".textus/library/mira.md",
            "mira",
            "---\nname: Mira Okafor\naliases: [Mira]\n---\nThe narrator. Marine biologist, 34, left-handed. Afraid of deep water since a diving accident at 19 - she never swims, and avoids looking straight down from boats.",
        )],
        ..AgentWorkspace::default()
    };
    let mut e = edit_in(story, StructureExpect::Any);
    e.doc_has = s(&["Mira"]);
    let ws_zh = AgentWorkspace {
        library: vec![crate::ai::project::parse_library_entry(
            ".textus/library/lin.md",
            "lin",
            "---\nname: 林晚\naliases: [晚晚]\n---\n林晚是中学语文老师，三十二岁，从不喝咖啡。",
        )],
        ..AgentWorkspace::default()
    };
    let mut q = no_edit();
    q.reply_any = s(&["语文"]);
    cases.push(AgentCase::new("library/zh-alias-fact", Lang::ZhHans, Lang::ZhHans, "# 第一章\n\n晚晚推开教室的门。\n", "晚晚是做什么工作的？用一句话回答。", q, "The library entry (reached through the alias 晚晚) says 林晚 is a middle-school Chinese teacher. Expect a one-sentence Chinese answer saying so, no edit.").mode(AgentMode::Review).workspace(ws_zh));
    cases.push(AgentCase::new("library/character-consistency", Lang::En, Lang::En, story, "After the first paragraph, add two sentences showing how Mira feels about the water.", e, "The library says Mira is afraid of deep water since a diving accident at 19, never swims, avoids looking down from boats. Expect two sentences inserted after the first paragraph that are consistent with that (fear, avoidance), in the story's restrained past-tense voice, not over-explained.").workspace(ws));

    // Skills: invoked by name (the frontend expands /name), and matched by
    // description through use_skill.
    let tighten = AgentSkill {
        name: "tighten".into(),
        description: "Cut wordiness from a passage without losing any fact".into(),
        prompt: "When tightening text: remove filler, doubled phrases and throat-clearing; keep every number, name and claim; aim for 40-60% of the original length; keep the author's register. Propose one edit per paragraph and say in one line how much shorter it got.".into(),
        ..AgentSkill::default()
    };
    let ws = AgentWorkspace {
        skills: vec![tighten.clone()],
        ..AgentWorkspace::default()
    };
    let mut e = edit_in(para(en, 1), StructureExpect::Same);
    e.shorter = true;
    cases.push(AgentCase::new("skill/slash-invoked", Lang::En, Lang::En, en, &resolve_skill_message("/tighten the Method paragraph", std::slice::from_ref(&tighten), en, "en"), e, "The user invoked the /tighten skill (its instructions are at the top of the message) on the Method paragraph. Expect one edit to that paragraph at roughly 40-60% of its length with every fact kept, and a one-line reply saying how much shorter it got.").workspace(ws));

    let headline = AgentSkill {
        name: "house-headline".into(),
        description: "Write or rewrite document titles and headlines in the house style".into(),
        prompt: "House style for titles: sentence case (only the first word and proper nouns capitalised), at most 8 words, no colon, no question mark, lead with the concrete result.".into(),
        ..AgentSkill::default()
    };
    let ws = AgentWorkspace {
        skills: vec![headline],
        ..AgentWorkspace::default()
    };
    let mut e = edit_in(
        "# Weekend Reading Club: first-year report",
        StructureExpect::Same,
    );
    e.tools = vec!["use_skill"];
    e.custom = Some(|o| {
        let title = o
            .doc_after
            .lines()
            .next()
            .unwrap_or("")
            .trim_start_matches('#')
            .trim()
            .to_string();
        let words = title.split_whitespace().count();
        let mut problems = Vec::new();
        if words > 8 {
            problems.push(format!("{words} words"));
        }
        if title.contains(':') || title.contains('?') {
            problems.push("colon or question mark".into());
        }
        problems
            .is_empty()
            .then_some(())
            .ok_or_else(|| format!("{title:?}: {}", problems.join(", ")))
    });
    cases.push(AgentCase::new("skill/matched-by-description", Lang::En, Lang::En, en, "Give this document a better title.", e, "A skill 'house-headline' matches this request: expect the agent to load it with use_skill and rewrite the H1 to follow it (sentence case, ≤8 words, no colon, leads with the result, e.g. growth to 310 readers).").workspace(ws));

    // Project files: facts the document needs live in another file.
    let ws = AgentWorkspace {
        root: Some(project_dir()),
        ..AgentWorkspace::default()
    };
    let mut e = edit_in(para(en, 2), StructureExpect::Same);
    e.doc_has = s(&["128", "307"]);
    e.custom = Some(|o| {
        o.tools
            .iter()
            .any(|t| t == "read_file" || t == "search_files")
            .then_some(())
            .ok_or_else(|| "never read the notes".to_string())
    });
    cases.push(AgentCase::new("files/facts-from-notes", Lang::En, Lang::En, en, "Update the attendance numbers in Findings using my interview notes.", e, "The project folder has notes/interviews.md with corrected figures (128 in January, 307 in December). Expect the agent to find and read it, then change only the two numbers in the Findings paragraph (optionally noting walk-ins/duplicates briefly).").workspace(ws));

    // A long document: outline only, so the agent must read the section.
    let long = super::long_doc();
    let mut e = edit_in(
        &long[long.find("In Coding block 0").unwrap()..long.find("In Coding block 1").unwrap()],
        StructureExpect::Same,
    );
    e.shorter = true;
    e.custom = Some(|o| {
        o.tools
            .iter()
            .any(|t| t == "read_document" || t == "search_document")
            .then_some(())
            .ok_or_else(|| "edited without reading the section".to_string())
    });
    cases.push(AgentCase::new("long/edit-one-section", Lang::En, Lang::En, &long, "Tighten the first paragraph of the 'Coding' section: same facts, fewer words.", e, "A 60k-character document seen only as an outline: expect read_document/search_document on the Coding section, then one edit to its first paragraph that keeps every site number and visit count while cutting the repetition."));
    cases
}

pub fn all_cases() -> Vec<AgentCase> {
    let mut cases = language_cases();
    cases.extend(structure_cases());
    cases.extend(behaviour_cases());
    cases.extend(super::agent_everyday::cases());
    cases.extend(super::agent_workspace::cases());
    cases.retain(|c| harness::selected(&c.id));
    cases
}

/// The automatic checks for one turn.
fn check_turn(case: &AgentCase, expect: &Expect, o: &TurnOutcome, checks: &mut Checks) {
    let proposed = o.tools.iter().any(|t| t == "propose_edit");
    match expect.edit {
        EditExpect::Required => {
            checks.expect("edit proposed", !o.proposals.is_empty(), || {
                "no valid propose_edit".into()
            });
            if let Some(err) = &o.apply_error {
                checks.add("edits apply", Err(err.clone()));
            }
        }
        EditExpect::Forbidden => checks.expect("no edit", !proposed, || {
            format!(
                "{} propose_edit call(s)",
                o.tools.iter().filter(|t| *t == "propose_edit").count()
            )
        }),
        EditExpect::Optional => {}
    }
    checks.expect("anchors valid first try", o.invalid_proposals == 0, || {
        format!("{} proposal(s) rejected by validation", o.invalid_proposals)
    });
    match expect.comments {
        Some(true) => checks.expect("comments", !o.comments.is_empty(), || {
            "no add_comment".into()
        }),
        Some(false) => checks.expect("no comments", o.comments.is_empty(), || {
            "unexpected comments".into()
        }),
        None => {}
    }
    checks.expect("reply present", !o.reply.trim().is_empty(), || {
        "empty closing reply".into()
    });
    checks.add(
        "reply language",
        checks::check_lang(&checks::unquoted(&o.reply), case.lang),
    );
    // The reply talks to a writer: no tool names, no line numbers.
    let process = checks::process_talk(&o.reply);
    checks.expect("no tool or line-number talk", process.is_none(), || {
        format!("reply says {:?}", process.unwrap_or_default())
    });
    if matches!(case.lang, Lang::ZhHans | Lang::ZhHant | Lang::Ja) {
        let half = checks::half_width_in_cjk(&o.reply);
        checks.expect("full-width punctuation in reply", half.is_none(), || {
            format!("{:?}", half.unwrap_or_default())
        });
    }
    if !expect.reply_any.is_empty() {
        let lower = o.reply.to_lowercase();
        checks.expect(
            "reply content",
            expect
                .reply_any
                .iter()
                .any(|k| lower.contains(&k.to_lowercase())),
            || format!("none of {:?} in reply", expect.reply_any),
        );
    }
    for t in &expect.tools {
        checks.expect(
            &format!("calls {t}"),
            o.tools.iter().any(|x| x == t),
            || format!("never called {t}"),
        );
    }

    if o.doc_after != o.doc_before {
        let (s, e, e2) = checks::changed_span(&o.doc_before, &o.doc_after);
        let inserted = &o.doc_after[s..e2];
        let removed = &o.doc_before[s..e];
        // Six words: shorter text says too little about its language
        // ("Do teams need SSO?" reads as Portuguese).
        if checks::word_count(inserted) >= 6 {
            checks.add(
                "edit language",
                checks::check_lang(inserted, expect.edit_lang.unwrap_or(case.doc_lang)),
            );
        }
        if let Some(region) = &expect.region {
            checks.add(
                "edit stays in target",
                checks::check_region(&o.doc_before, &o.doc_after, region),
            );
        }
        let (before_sk, after_sk) = (
            checks::skeleton(&o.doc_before),
            checks::skeleton(&o.doc_after),
        );
        checks.add(
            "markdown structure",
            checks::check_structure(&before_sk, &after_sk, expect.structure),
        );
        if expect.keep_inline {
            let lost = checks::lost_inline(&before_sk, &after_sk);
            checks.expect("inline formatting kept", lost.is_empty(), || {
                format!("lost {lost:?}")
            });
        }
        if expect.shorter {
            checks.expect(
                "shorter",
                checks::word_count(inserted) < checks::word_count(removed),
                || {
                    format!(
                        "{} -> {} words",
                        checks::word_count(removed),
                        checks::word_count(inserted)
                    )
                },
            );
        }
        if expect.longer {
            checks.expect(
                "longer",
                checks::word_count(inserted) > checks::word_count(removed),
                || {
                    format!(
                        "{} -> {} words",
                        checks::word_count(removed),
                        checks::word_count(inserted)
                    )
                },
            );
        }
    }
    for needle in &expect.doc_has {
        checks.expect(
            &format!("has {needle:?}"),
            o.doc_after.contains(needle.as_str()),
            || "missing from the result".into(),
        );
    }
    for needle in &expect.doc_lacks {
        checks.expect(
            &format!("lacks {needle:?}"),
            !o.doc_after.contains(needle.as_str()),
            || "still in the result".into(),
        );
    }
    for t in &expect.no_tools {
        checks.expect(
            &format!("never calls {t}"),
            !o.tools.iter().any(|x| x == t),
            || format!("called {t}"),
        );
    }
    let skip_edit_checks = expect.edit == EditExpect::Required && o.proposals.is_empty();
    if let Some(custom) = expect.custom {
        if !skip_edit_checks {
            checks.add("case-specific", custom(o));
        }
    }
    for (name, check) in &expect.named {
        if !skip_edit_checks {
            checks.add(name, check(o));
        }
    }
}

/// Every file under `dir` (relative path -> content, clipped), for the
/// record: the workspace exactly as the case built it.
fn files_under(dir: &Path) -> serde_json::Map<String, Value> {
    let mut out = serde_json::Map::new();
    let mut pending = vec![dir.to_path_buf()];
    while let Some(d) = pending.pop() {
        let Ok(entries) = std::fs::read_dir(&d) else {
            continue;
        };
        let mut paths: Vec<PathBuf> = entries.flatten().map(|e| e.path()).collect();
        paths.sort();
        for p in paths {
            if p.is_dir() {
                pending.push(p);
            } else if let Ok(text) = std::fs::read_to_string(&p) {
                let rel = p
                    .strip_prefix(dir)
                    .unwrap_or(&p)
                    .to_string_lossy()
                    .into_owned();
                out.insert(rel, json!(harness::clip(&text, 6_000)));
            }
        }
    }
    out
}

fn workspace_json(ws: &AgentWorkspace) -> Value {
    json!({
        "instructions": ws.instructions,
        "project_instructions": ws.project_instructions,
        "skills": ws.skills.iter().map(|s| json!({"name": s.name, "description": s.description, "prompt": s.prompt})).collect::<Vec<_>>(),
        "root": ws.root,
        "style": ws.style,
        "library": ws.library.iter().map(|e| json!({"name": e.name, "aliases": e.aliases, "file": e.file, "body": e.body})).collect::<Vec<_>>(),
    })
}

/// The case's inputs for the record (the workspace as loaded is added at
/// run time).
fn case_input(case: &AgentCase) -> Value {
    json!({
        "document": case.doc,
        "doc_chars": case.doc.chars().count(),
        "user_lang": case.lang.code(),
        "doc_lang": case.doc_lang.code(),
        "mode": case.mode,
        "script": case.script.iter().map(|t| json!({
            "message": t.message,
            "accept_proposals": t.accept,
            "quick_ask_selection_follows": t.follow_selection,
            "cursor": t.caret.cursor,
            "selection": t.caret.selection,
        })).collect::<Vec<_>>(),
        "disk_workspace": case.disk.as_ref().map(|d| json!({
            "global_agent_dir": d.global.as_ref().map(|p| p.display().to_string()),
            "doc_path": d.doc_path.as_ref().map(|p| p.display().to_string()),
            "workspace_root_override": d.root_override.as_ref().map(|p| p.display().to_string()),
            "files": d.show.iter().map(|dir| json!({"dir": dir.display().to_string(), "files": files_under(dir)})).collect::<Vec<_>>(),
        })),
        "learn_style": case.learn.as_ref().map(|l| json!({
            "samples": l.samples.iter().map(|p| json!({
                "name": p.file_name().map(|n| n.to_string_lossy().into_owned()),
                "text": std::fs::read_to_string(p).unwrap_or_default(),
            })).collect::<Vec<_>>(),
            "writes": l.write_to.as_ref().map(|p| p.display().to_string()),
        })),
        "rubric": case.rubric,
    })
}

/// Document text for the record: in full when it is short enough to read,
/// otherwise the changed region with context (`diff` always has it too).
fn recorded_doc(doc: &str) -> Value {
    if doc.chars().count() <= 15_000 {
        json!(doc)
    } else {
        json!(format!("({} chars - see diff)", doc.chars().count()))
    }
}

fn turn_json(o: &TurnOutcome, model: &str) -> Value {
    let mut usage = harness::Usage::default();
    for u in &o.usage {
        usage.add(model, u);
    }
    json!({
        "message": o.message,
        "message_sent": o.message_sent,
        "cursor": o.caret.cursor,
        "selection": o.caret.selection,
        "focus_heading": o.focus_heading,
        "reply": o.reply,
        "tools": o.tools,
        "tool_calls": o.calls,
        "proposals": o.proposals.iter().map(|p| json!({"action": p.action, "anchor": p.anchor, "text": p.text, "context": p.context})).collect::<Vec<_>>(),
        "invalid_proposals": o.invalid_proposals,
        "invalid_proposal_errors": o.invalid_errors,
        "postfix": o.postfix,
        "comments": o.comments,
        "apply_error": o.apply_error,
        "document_changed": o.doc_after != o.doc_before,
        "diff": harness::diff_view(&o.doc_before, &o.doc_after),
        "document_after": if o.doc_after != o.doc_before { recorded_doc(&o.doc_after) } else { Value::Null },
        "latency_ms": o.latency_ms as u64,
        "steps": o.usage.len(),
        "usage": usage.json(),
        // Per request: what prompt caching read and wrote at each step.
        "step_usage": o.usage.iter().map(|u| json!({
            "input": u.input_tokens,
            "cache_write": u.cache_creation_input_tokens,
            "cache_read": u.cache_read_input_tokens,
            "output": u.output_tokens,
        })).collect::<Vec<_>>(),
    })
}

pub fn run_case(auth: &AnthropicAuth, case: &AgentCase, model: &str) -> Record {
    let mut input = case_input(case);
    if let Some(reason) = harness::budget_exhausted() {
        return harness::skipped(&case.id, model, case.lang.code(), reason, input);
    }
    // Learning a style is a completion request, which the harness makes on
    // Claude only (harness::complete); on another provider it would ask
    // Claude for that provider's model.
    if case.learn.is_some() && harness::agent_provider_id() != "anthropic" {
        let reason = format!(
            "learning a style runs on Claude, not {}",
            harness::agent_provider_id()
        );
        return harness::not_run(&case.id, model, case.lang.code(), reason, input);
    }
    let mut checks = Checks::default();
    let mut usage = harness::Usage::default();
    let mut output = serde_json::Map::new();
    let mut latency = 0u128;

    // "Learn my style" first: the profile it writes is what the workspace
    // load below reads back.
    let mut learned: Option<String> = None;
    if let Some(learn) = &case.learn {
        let files: Vec<String> = learn
            .samples
            .iter()
            .map(|p| p.display().to_string())
            .collect();
        let samples = crate::ai::project::style_samples(&files).unwrap_or_default();
        match harness::complete(
            auth,
            &crate::ai::project::style_instructions(),
            &samples,
            Some(model),
        ) {
            Ok(reply) => {
                usage.add(&reply.model, &reply.usage);
                latency += reply.ms;
                let profile = reply.text.trim().to_string();
                checks.expect("profile written", !profile.is_empty(), || {
                    "empty profile".into()
                });
                for (name, check) in &learn.checks {
                    checks.add(name, check(&profile, &samples));
                }
                if let Some(path) = &learn.write_to {
                    if let Some(parent) = path.parent() {
                        let _ = std::fs::create_dir_all(parent);
                    }
                    std::fs::write(path, format!("{profile}\n")).expect("write style.md");
                }
                output.insert("learned_profile".into(), json!(profile));
                output.insert("learn_latency_ms".into(), json!(reply.ms as u64));
                learned = Some(profile);
            }
            Err(e) => checks.add("request", Err(e)),
        }
    }

    let ws = match &case.disk {
        Some(d) => crate::ai::workspace::load_from(
            d.global.as_deref(),
            d.doc_path
                .as_ref()
                .map(|p| p.to_string_lossy().into_owned())
                .as_deref(),
            d.root_override
                .as_ref()
                .map(|p| p.to_string_lossy().into_owned())
                .as_deref(),
        ),
        None => case.workspace.clone(),
    };
    input["workspace_loaded"] = workspace_json(&ws);

    if !case.script.is_empty() && checks.0.iter().all(|c| c.name != "request") {
        let script: Vec<UserTurn> = case
            .script
            .iter()
            .map(|t| UserTurn {
                // As ai_agent_message: the packs filtered by the profile the
                // case's style.md chose (no Settings in the eval).
                message: crate::ai::builtin::expand_message_with(
                    &t.message,
                    &ws.skills,
                    &case.doc,
                    case.lang.ui_code(),
                    crate::ai::builtin::chosen_profile(
                        &crate::ai::rules::Conventions {
                            setting: None,
                            project: ws.conventions.clone(),
                        },
                        &case.doc,
                    )
                    .as_deref(),
                ),
                ..t.clone()
            })
            .collect();
        let setup = AgentSetup {
            model,
            mode: case.mode,
            workspace: &ws,
            focus_heading: None,
            // The UI in the language the user writes in.
            ui_language: case.lang.ui_code(),
            thinking: aicompat::capabilities::ThinkingLevel::Auto,
            pictures: None,
            memory: None,
        };
        let conv = run_conversation(auth, &setup, &case.doc, &script);
        if let Some(e) = &conv.error {
            checks.add("request", Err(e.clone()));
        }
        for (expect, outcome) in case.expects.iter().zip(&conv.outcomes) {
            check_turn(case, expect, outcome, &mut checks);
        }
        usage.merge(&conv.usage());
        latency += conv.latency_ms();
        output.insert(
            "turns".into(),
            json!(conv
                .outcomes
                .iter()
                .map(|o| turn_json(o, model))
                .collect::<Vec<_>>()),
        );
        output.insert("error".into(), json!(conv.error));
        if !conv.outcomes.is_empty() {
            let verdict_material = conversation_material(&conv);
            output.insert("judge_material".into(), json!(verdict_material));
        }
    }

    // A completion under the same workspace's style profile.
    if let Some(completion) = &case.then_complete {
        let mut c = completion.clone();
        if let Some(style) = ws.style.clone().or(learned) {
            c.style_profile = Some(Box::leak(style.into_boxed_str()));
        }
        let (_, user_text, tone) = super::completion_matrix::request_for(&c);
        input["completion"] = super::completion_matrix::case_input(&c, &user_text, tone);
        let mut cchecks = Checks::default();
        let (out, ms, u, _) = super::completion_matrix::complete_and_check(
            auth,
            &c,
            &harness::writing_model(),
            &mut cchecks,
        );
        for check in cchecks.0 {
            checks.0.push(harness::Check {
                name: format!("completion: {}", check.name),
                ..check
            });
        }
        usage.merge(&u);
        latency += ms;
        output.insert("completion".into(), out);
    }

    let verdict = output.get("judge_material").and_then(|m| {
        harness::judge(
            auth,
            &format!("An AI writing agent in {} mode answered a user in a Markdown editor. User language: {}; document language: {}.", case.mode, case.lang.code(), case.doc_lang.code()),
            &case.rubric,
            m.as_str().unwrap_or(""),
        )
    });
    Record {
        case: case.id.clone(),
        model: model.to_string(),
        lang: case.lang.code().into(),
        latency_ms: latency,
        usage,
        checks,
        verdict,
        input,
        output: Value::Object(output),
    }
}

/// The comparison subset: one case of each kind, small enough to run on
/// every candidate agent model.
pub const COMPARISON_CASES: &[&str] = &[
    "lang/zh-Hans/shorten",
    "lang/ja/question",
    "lang/de/shorten",
    "cross/en-asks-zh-doc/shorten",
    "md/table-add-row",
    "md/code-fix-bug",
    "md/footnote-add",
    "md/rewrite-keeps-inline",
    "task/summarize-in-chat",
    "task/insert-at-cursor-en",
    "review/revise-mode-comments",
    "ambiguous/make-it-better",
    "multi/en-rejected-retry",
    "agentmd/reply-language-and-spelling",
    "skill/matched-by-description",
    "files/facts-from-notes",
    "long/edit-one-section",
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_case_is_well_formed() {
        let cases = all_cases();
        assert!(cases.len() > 140, "{} cases", cases.len());
        let mut ids = std::collections::HashSet::new();
        for case in &cases {
            assert!(ids.insert(case.id.clone()), "duplicate id {}", case.id);
            assert_eq!(case.script.len(), case.expects.len(), "{}", case.id);
            assert!(
                !case.script.is_empty() || case.learn.is_some(),
                "{}: nothing to run",
                case.id
            );
            if let Some(region) = case.expects.first().and_then(|e| e.region.as_ref()) {
                assert!(
                    case.doc.contains(region.as_str()),
                    "{}: region not in the document",
                    case.id
                );
            }
            if let Some((s, e)) = case.script.first().and_then(|t| t.caret.selection) {
                assert!(
                    e <= case.doc.len()
                        && case.doc.is_char_boundary(s)
                        && case.doc.is_char_boundary(e),
                    "{}",
                    case.id
                );
            }
            if let Some(learn) = &case.learn {
                assert!(
                    learn.samples.iter().all(|p| p.exists()),
                    "{}: samples missing",
                    case.id
                );
            }
        }
    }

    #[test]
    fn slash_skills_expand_like_the_composer() {
        let skills = vec![AgentSkill {
            name: "润色".into(),
            description: String::new(),
            prompt: "Polish it.".into(),
            ..AgentSkill::default()
        }];
        assert_eq!(
            resolve_skill_message("/润色 第二段", &skills, "", "zh"),
            "<skill name=\"润色\">\nPolish it.\n</skill>\n\n第二段"
        );
        assert_eq!(
            resolve_skill_message("/润色", &skills, "", "zh"),
            "<skill name=\"润色\">\nPolish it.\n</skill>"
        );
        assert_eq!(
            resolve_skill_message("/other x", &skills, "", "zh"),
            "/other x"
        );
        assert_eq!(resolve_skill_message("plain", &skills, "", "zh"), "plain");
    }

    fn load(case_id: &str) -> AgentWorkspace {
        let case = all_cases()
            .into_iter()
            .find(|c| c.id == case_id)
            .expect("case");
        let d = case.disk.as_ref().unwrap();
        let path = |p: &Option<PathBuf>| p.as_ref().map(|p| p.to_string_lossy().into_owned());
        crate::ai::workspace::load_from(
            d.global.as_deref(),
            path(&d.doc_path).as_deref(),
            path(&d.root_override).as_deref(),
        )
    }

    #[test]
    fn disk_workspaces_load_through_the_app_loader() {
        let ws = load("agentmd/global-plus-workspace");
        assert_eq!(ws.instructions.len(), 1, "the global layer");
        assert!(ws.project_instructions.is_some(), "and the project's");
        assert!(
            !ws.instructions[0].contains("French"),
            "comments are stripped"
        );
        let ws = load("workspace/en/override-root");
        assert!(ws.root.as_deref().unwrap().ends_with("research"));
        assert!(
            ws.instructions.is_empty() && ws.project_instructions.is_none(),
            "the document folder's agent.md doesn't apply"
        );
        let ws = load("skill/en/project-shadows-global");
        let own: Vec<_> = ws
            .skills
            .iter()
            .filter(|s| s.source != crate::ai::workspace::SkillSource::Builtin)
            .collect();
        assert_eq!(own.len(), 1);
        assert!(own[0].prompt.contains("at most 6 words"));
        let ws = load("library/en/alias-fact");
        assert_eq!(ws.library.len(), 2);
        assert!(crate::ai::project::relevant_library(&ws.library, "the captain").len() == 1);
        let ws = load("workspace/en/unsaved-draft");
        assert!(ws.root.is_none());
    }
}
