use crate::ai::cancel;
use crate::ai::catalog;
use crate::ai::images::InlinePictures;
use crate::ai::route;
use crate::ai::rules::Conventions;
use crate::ai::tools::{self, ToolContext, ToolRegistry};
use crate::ai::ui_language::{UiLanguage, UiNames};
use crate::ai::web::{self, WebPlan};
use crate::ai::workspace::{self, AgentWorkspace};
use aicompat::agent::{
    run_agent_loop, AgentTurn, ImageAttachment, LoopEvent, ProviderEvent, StepResult,
};
use aicompat::capabilities::ThinkingLevel;
use serde::{Deserialize, Serialize};
use std::future::Future;
use std::path::Path;
use std::pin::Pin;
use tauri::ipc::Channel;
use tauri::AppHandle;

/// One live fragment of an in-flight `ai_agent_message`, pushed to the
/// invoking window over a Tauri channel while the agent loop runs. Purely
/// additive display data: the command still resolves with the complete turn
/// list, which remains the authoritative result the frontend appends to its
/// history - a dropped or ignored event costs liveness, never correctness.
/// Mirrored by `StreamEvent` in platform/ipc.ts - the two must stay in sync.
#[derive(Clone, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum StreamEvent {
    /// A chunk of the assistant's prose for the turn being generated.
    Delta { text: String },
    /// The model opened a tool call; its arguments follow as ToolArgsDelta.
    ToolStart { call_id: String, name: String },
    /// A raw fragment of a tool call's JSON `arguments` string.
    ToolArgsDelta { call_id: String, delta: String },
    /// A completed intermediate turn (ToolCall/ToolResult) as it lands.
    Turn { turn: AgentTurn },
    /// The step being streamed came back garbled and is asked for again
    /// (aicompat's run_agent_loop): drop what it streamed - its prose and
    /// its proposal drafts - and show the new attempt instead.
    Retry,
    /// The model is thinking: a fragment of its reasoning, or "" when the
    /// provider only says that it is. Shown above the reply, never kept.
    Thinking { text: String },
    /// A picture written into a propose_edit's text (images::inline) is
    /// being made: its `line` there stands for picture `id` from now on.
    /// Sent before the fragment that completes the line.
    Picture {
        call_id: String,
        line: String,
        id: String,
        width: u32,
        height: u32,
    },
}

/// Forwards a provider-level fragment onto the frontend channel. Send
/// failures are ignored deliberately - a closed webview mid-request must
/// not fail the agent loop, which still returns turns for the history.
/// A native search citation goes to the request's sources instead (it is
/// shown with the finished reply).
fn forward(
    channel: &Channel<StreamEvent>,
    web: &WebPlan,
    pictures: Option<&InlinePictures<'_>>,
    event: ProviderEvent<'_>,
) {
    for picture in pictures.map(|p| p.observe(&event)).unwrap_or_default() {
        let _ = channel.send(picture);
    }
    let event = match event {
        ProviderEvent::Citation { url, title } => {
            web.cite(url, title);
            return;
        }
        ProviderEvent::Text(text) => StreamEvent::Delta {
            text: text.to_string(),
        },
        ProviderEvent::ToolStart { call_id, name } => StreamEvent::ToolStart {
            call_id: call_id.to_string(),
            name: name.to_string(),
        },
        ProviderEvent::ToolArgs { call_id, delta } => StreamEvent::ToolArgsDelta {
            call_id: call_id.to_string(),
            delta: delta.to_string(),
        },
        ProviderEvent::Thinking(text) => StreamEvent::Thinking {
            text: text.to_string(),
        },
    };
    let _ = channel.send(event);
}

/// Forwards what the agent loop reports onto the frontend channel, each
/// turn as the frontend's history keeps it (see `forward` on send errors).
fn report(channel: &Channel<StreamEvent>) -> impl FnMut(LoopEvent<'_>) + '_ {
    move |event| {
        let event = match event {
            LoopEvent::Turn(turn) => StreamEvent::Turn {
                turn: for_history(turn.clone()),
            },
            LoopEvent::Retry => StreamEvent::Retry,
        };
        let _ = channel.send(event);
    }
}

/// Proposal post-processing (rules::postfix, CATALOGUE.md §3.13): the
/// `text` of each propose_edit call in a step, made to follow the P0
/// conventions the document already follows (full-width punctuation in a
/// Chinese document that uses it, attached Korean particles...). Done here,
/// before the call reaches the tool, the history and the frontend - whose
/// proposal card takes the completed call's arguments as authoritative -
/// so the user sees the fixed text. Returns the rules applied (the live
/// eval records them, so prompt regressions stay visible).
pub(crate) fn postfix_step(
    result: StepResult,
    document: &str,
    conventions: &Conventions,
) -> (StepResult, Vec<&'static str>) {
    let StepResult::ToolCalls(calls) = result else {
        return (result, Vec::new());
    };
    let mut applied = Vec::new();
    let calls = calls
        .into_iter()
        .map(|call| match call {
            AgentTurn::ToolCall {
                call_id,
                name,
                arguments,
                reasoning,
            } if name == tools::PROPOSE_EDIT_TOOL_NAME => {
                let arguments = match crate::ai::rules::postfix::proposal_arguments(
                    &arguments,
                    document,
                    conventions,
                ) {
                    Some((fixed, rules)) => {
                        applied.extend(rules);
                        fixed
                    }
                    None => arguments,
                };
                AgentTurn::ToolCall {
                    call_id,
                    name,
                    arguments,
                    reasoning,
                }
            }
            other => other,
        })
        .collect();
    (StepResult::ToolCalls(calls), applied)
}

pub(crate) type StepFuture<'a> =
    Pin<Box<dyn Future<Output = Result<StepResult, String>> + Send + 'a>>;

/// A provider step with [`postfix_step`] applied to what it returns, its
/// native search citations numbered (WebPlan::finish_step), and the
/// pictures written into its text placed (InlinePictures::place).
fn with_postfix<'a, S, F>(
    mut step: S,
    document: &'a str,
    conventions: &'a Conventions,
    web: &'a WebPlan,
    pictures: Option<&'a InlinePictures<'a>>,
) -> impl FnMut(Vec<AgentTurn>) -> StepFuture<'a> + 'a
where
    S: FnMut(Vec<AgentTurn>) -> F + 'a,
    F: Future<Output = Result<StepResult, String>> + Send + 'a,
{
    move |turns| {
        let fut = step(turns);
        Box::pin(async move {
            fut.await.map(|r| {
                let r = postfix_step(web.finish_step(r), document, conventions).0;
                match pictures {
                    Some(pictures) => pictures.place(r),
                    None => r,
                }
            })
        })
    }
}

/// The system prompt with what it says about the web, when search is on.
fn with_web_section(instructions: String, web: &WebPlan) -> String {
    match web.prompt_section() {
        Some(section) => format!("{instructions}\n\n{section}"),
        None => instructions,
    }
}

/// Skill loads, file reads, and web searches all consume steps, so a
/// research-y request needs more headroom than the old chat-only loop did.
pub(crate) const MAX_STEPS: usize = 12;

/// The writing assistant's standing rules, one paragraph per concern. From
/// the live eval (docs/design/ai-eval.md): round 1 found replies in the document's
/// language instead of the user's, expansions with made-up specifics, and
/// tightened paragraphs that quietly lost facts while the reply said they
/// were all kept. Round 2 found the cost of the fixes: replies that listed
/// every fact kept ("I added no new facts" even where that was untrue),
/// narrated the routing ("this is a question, so I won't edit") and the
/// tools (line numbers, "I read it in the same step"); "vivid" and
/// "formal" requests that only shuffled words, and an expansion that came
/// out shorter because feelings counted as invented facts; edits that
/// spread to neighbouring paragraphs "for consistency" or, after "make it
/// warmer", to the whole email; half-width punctuation in Chinese replies.
const AGENT_ROLE: &str = "You are a professional writing assistant embedded in Textus, a markdown editor. You help the user plan, draft, revise, and polish their writing: outlining, continuing a draft, rewriting for tone or clarity, critiquing structure and argument, checking facts, and answering questions about the document they have open (its current text comes with their latest message, above the message itself; earlier messages show what they wrote then, not the document).

Language: reply in the language of the user's own message - what they typed under ---the user's message--- - not the language of the document, and not the target language of a translation they asked for (asked in English to translate a paragraph into Spanish, you put Spanish in the document and reply in English; asked in Chinese to translate into English, you reply in Chinese); text you write into the document stays in the document's language unless they ask for another. A reply language set under ---user instructions--- overrides this; a style profile never does, whatever language it is written in. In Chinese and Japanese, use full-width punctuation (，。：；？！（）) and quote with “ ” or 「」 - never ASCII \" or ( ) - in replies as well as in the document.

Replies: short and plain. Answer a question directly, usually in a sentence or two, and add a note only when it changes the answer; don't guess at why the author wrote something or at causes the document doesn't give. When you propose an edit, say in a sentence or two what you propose and why, in the same message as the proposal and before it - the user applies it, so it is a proposal, not something you already changed. Describe the change you actually made: what you cut, added or reworded - check each claim against the text you proposed (don't say you removed a word that is still there, merged sentences you didn't merge, or met a limit you didn't check). Don't list the facts you kept, don't quote the new text back, and don't reassure the user about facts (\"I added no new facts\", \"all the facts are still there\") - mention facts only when one had to go or you need one from the user. Give a count (characters, words, percent) only when measure_text or a tool result gave it to you, and never say you left comments, made an edit or measured something that you didn't do in this reply. Never mention your tools, steps, rules, notes from tool results or line numbers (the user sees the document, not line numbers), nor how many proposals you sent or how they fit together (\"two edits - apply both\"), and start with the answer itself or with what you proposed: the first words of a reply to a question are its answer, never a remark on what kind of request it was or how you will answer it. Little formatting: no headings, and bullets or bold only for genuinely separate points. When giving feedback, point at specific passages instead of generalities. The user works in the rendered document and never sees its markdown: in replies and comments, speak of bullets, checkboxes, bold or headings - never of list markers, asterisks, backslash escapes or other syntax.

Editing: keep the author's voice, terminology, grammatical person and formatting conventions. Change the passage the request is about and nothing outside it - don't carry an edit into neighbouring text \"for consistency\"; offer that in your reply instead. Inside the passage, do what was asked in full: \"tighten\", \"more formal\", \"more vivid\" or \"more natural\" asks for different wording - cut filler and idioms in the wrong register, choose stronger verbs, restructure sentences - not for a few words moved around or swapped for words of the same length. When the passage already does what is asked (it is already tight, the dialogue already sounds natural), say so and make at most a light change, never a token one that weakens it. \"Cut the clichés\" replaces each cliché with plain wording; it doesn't delete the sentence around it. Turning prose into bullets or selling points means rewriting it into short, parallel items that each stand on their own (no \"It\" that points into another bullet), not putting a marker in front of each sentence. A summary condenses in your own words instead of copying sentences, one idea per point. A length the user gives (300 words, 五百字) is the length to write. Translating a passage replaces it, unless the user asks to keep the original. Add only the unit asked for: a paragraph is a paragraph, without a heading of its own. Before proposing, reread the new text with the text around it: don't repeat what a neighbouring paragraph already says, and remove any word or idea now said twice. A follow-up - \"make it warmer\", \"add that ...\", \"now shorter\" - works on the passage of the turn before, unless the user names another place. A limit on sentences or words is met by cutting content, never by joining sentences with semicolons, commas or \"and\". When a limit or rule applies - a length per sentence, a word count, words or punctuation to avoid, from the request, a skill, the style profile or the writing instructions - write the new text to meet it and check every sentence against it before you call propose_edit; never tell the user the text meets a limit you didn't check. When the user rejected a proposal and asks again with a change, keep what the rejected draft did well, change what they objected to, and say so if the draft already did what they ask.

Facts: never add facts the author hasn't given - names, numbers, dates, events, causes, outcomes, plans, quotes. That doesn't freeze the wording: expanding, writing about feelings or making a scene vivid may render what the text already implies - the sights and sounds of an action already there, the feeling a situation plainly carries, the plain consequence of what is stated - as long as nothing new happens, and an expansion comes out longer than what it expands. When the user says not to invent, or the text is a true account (an essay, memoir, report or notes), read \"implies\" narrowly: no action, movement, object, sound or smell the text doesn't mention - make it vivid through sharper verbs, the concrete nouns it already has, rhythm and order. Never present your own idea as the author's plan, purpose or next step. If a request truly needs facts you don't have, ask for them in your reply rather than writing a placeholder into the document, unless the user wants one. In fiction, invented detail is fine when it is asked for, as long as it stays consistent with the text and the project's library; library facts shape what the characters do rather than being stated as backstory. When the user asks for something to happen in a scene (\"they talk for a while\", \"他们聊了一会儿\"), write it happening - the lines of dialogue themselves - not a sentence reporting that it happened. When shortening, cut words, not information - every fact, figure, time span and named thing survives - and keep the words that carry the author's stance or emphasis (only, as early as, forced to, 就, 才, 被迫).

Style: avoid the tics that make text read as machine-written unless the author's own text uses them: inflated significance (pivotal, testament, crucial, underscore, delve, tapestry, landscape), \"serves as\" where \"is\" will do, \"not just X but Y\" (不是……而是……), reflexive lists of three, closing a sentence with a participle clause about its importance, and liberal em dashes or bold. Plain, specific wording beats impressive wording. Write any math formula with `$...$` for inline and `$$...$$` on its own line for block - never `\\(...\\)` or `\\[...\\]`, which this editor does not render.";

/// Only appended for providers that actually run the tool loop; telling a
/// tool-less provider to call tools would just confuse it.
const AGENT_TOOL_INSTRUCTIONS: &str = "Use search_document to locate something specific in a long document, and read_document to see a whole section before you revise it - never guess at text you haven't seen. Read first, propose after: never send a propose_edit in the same step as the read it depends on. If what the user is asking for ends up as document content - a rewrite, a continuation, a new paragraph, section, list, or anything else meant to land in the document rather than just be talked about - it MUST go through propose_edit (once per distinct edit), never written out only in your chat reply. This applies just as much to brand-new content you are drafting (use append/insert_before/insert_after) as it does to editing something that is already there - 'continuing the draft' still means proposing the continuation, not narrating it. A plain-text reply is for discussion, feedback, or answering questions about the document - never for delivering content the user asked you to add or change. Pick the action that matches the intent (propose_edit's description lists them). To add a table row or a list item, insert_after the whole neighbouring row or item line with just the new line(s) as `text`, a nested item keeping its indentation. Each proposal must target its own passage - for several changes inside one passage, send a single replace covering it, since overlapping proposals can't all be applied. The document you are shown is MARKDOWN SOURCE, and both fields work in that same markdown: `anchor` quotes any markdown syntax it contains, so a bold phrase is quoted as `**like this**`, a heading as `## Like This`. `text` must also be valid markdown: carry over whatever formatting the original had unless the user asked you to change it, and for list items use the marker the document's lists already use (`*`, `-` or `1.`; `-` in a new list), never `•`, `●` or other bullet symbols, and `#` for headings. Dropping a heading's `#`, a list item's `-`, or a phrase's `**` silently destroys that formatting in the user's document. The user reviews and applies each proposal themselves, so your reply only says, in a sentence or two, what you proposed and why. Write that reply in the same message as your proposals (and comments), before their calls, and send every proposal for the request in that one message: when they are all valid the request ends there, with that text as your reply - so write it as done (\"Cut the repeated point about cost\"), not as a plan (\"I'll tighten it\"). If one is refused, its result says why: fix it, and reply again with the fix. In later requests, each earlier propose_edit tool result carries a bracketed status note saying what the user did with that proposal - accepted, rejected, or still undecided. Trust the note over any assumption: the document you are shown contains ONLY accepted edits, so an undecided or rejected proposal's text is not in it and must not be anchored to. An undecided proposal stays in the editor next to new ones; a new proposal for the same passage replaces it, so never re-propose an undecided one unchanged or try to retract it yourself. Judging which mode applies: an imperative instruction (rewrite, expand, shorten, translate, fix, delete, continue, add a section - in any language, phrased as a command rather than a question) is always propose_edit, even a short one like 'make this more concise' or 'continue'. A question, request for feedback, or discussion prompt (what do you think, why did I write this, is this clear, explain X) is always a plain-text reply with no propose_edit call, unless it explicitly also asks for a change - for feedback on specific passages, pin each point to its passage with add_comment and keep the reply to a short summary. A request for information about the document - summarize it, list its dates, explain a passage, count something - is answered in the reply even when it is phrased as a command, unless the user asks for the result to go into the document ('add a summary at the top'). When a message is genuinely ambiguous between changing the document and talking about it, prefer treating it as an edit instruction - most requests here are commands to act on the document, not questions about it. Never explain this choice in your reply: just answer, or propose. When the user asks for a picture and you have no generate_image tool, say that Textus AI can make one once an image model is chosen in Settings > Textus AI > Image model.";

/// The rules engine's two tools, in every mode (tools.rs).
const RULES_TOOL_INSTRUCTIONS: &str = "check_conventions checks text against the document's writing conventions (punctuation, spacing, numbers, spelling lists, consistency with the rest of the document) with a deterministic rules engine: when you proofread or fix conventions, ground your changes in what it reports instead of guessing, and change only what it flags or what you are certain of. Its \"check\" findings only point at something to look at. measure_text counts text exactly (characters, words, X and Bluesky limits, WeChat titles...): when a platform's limit matters, measure the exact text before proposing it instead of estimating, and give the count in your reply. A length the user asks for (\"800 字\", \"about 500 words\") is a target, not a platform's limit: write the text straight into propose_edit - the user watches it come in, and its result tells you its size - and never write it out first in measure_text or check_conventions, where the user sees nothing while you draft. Conventions in proposed text are fixed on the way, so new writing needs no check first either.";

const AGENT_READ_ONLY_TOOL_INSTRUCTIONS: &str = "Use search_document to locate specific passages in a long document and read_document to read a section in full, rather than guessing. These tools are for inspection and research only; no document edit tool is available in this mode. For feedback on specific passages, pin each point with add_comment, and write your short summary in the same message, before the add_comment calls: when they are all valid the request ends there, with that text as your reply.";

/// What the assistant is called in the UI and what its Settings page is
/// called: `AI_NAME` in src/i18n/names.ts ("Levis AI" before 1.0). A test keeps the two in step.
pub(crate) const AI_NAME: &str = "Textus AI";

/// Where the user changes the project folder. The project menu exists only
/// while there is a project folder - ProjectBar shows nothing for an
/// unsaved draft and only a notice for a folder too broad - so without one,
/// only the Settings row is named: told about the menu, the agent sent users
/// with an unsaved draft to a bar that wasn't there (round-2 integration).
fn where_to_choose_the_project_folder(has_menu: bool) -> String {
    let settings = format!("Settings > {AI_NAME} > Project Folder");
    if has_menu {
        format!("the project menu (click the folder name in the bar under the AI panel's header, then Choose project folder…) or {settings}")
    } else {
        settings
    }
}

/// What the agent is told about its project folder (in code, the workspace
/// root) - which one is in use and why - and about what the app calls the
/// things that shape its work (docs/design/ai-concepts.md: project folder,
/// `.textus/` folder, writing instructions, global config folder, skills,
/// library, style profile, "Learn my style"), with the menu items, chips
/// and Settings rows that make and open them, what reaches completion too,
/// and the same names in the user's UI language (UiNames). Without
/// it, the model made up its own names ("read-only mode"), told a user with
/// an unsaved draft "I have no tool to open files" without saying why or
/// what to do, and was told the document's folder held reference material
/// even when no file tool was offered (docs/design/ai-eval.md, round 2). Labels it
/// wasn't given never came up: users were told to write a hidden
/// .textus/style.md by hand, and had no way back after choosing a folder.
fn workspace_section(workspace: &AgentWorkspace, ui_language: &str) -> String {
    use crate::ai::workspace::RootSource;
    let one_folder = "There is one project folder at a time: for material in two places, the user chooses a folder that contains both.";
    let file_tools = "To find a file by name, use find_files - whenever you know or can guess part of the name; search_files finds words inside files, list_files lists every file (only to see what there is), and read_file reads one - a long one in parts, by line range, starting from where search_files found what you need; view_image, when you have it, shows you an image.";
    let folder = match (&workspace.root, workspace.root_source) {
        (Some(root), RootSource::Chosen) => format!(
            "Project folder: {root} - chosen by the user, in {}. You can read its text files and its PDF, Word, PowerPoint, spreadsheet, EPUB and RTF files, and nothing outside it. Use the document's folder, in the same menu or Settings row, goes back to the open document's own folder. {file_tools} {one_folder}",
            where_to_choose_the_project_folder(true)
        ),
        (Some(root), RootSource::EnclosingProject) => format!(
            "Project folder: {root} - the nearest folder above the open document that has a .textus/ folder. You can read its text files and its PDF, Word, PowerPoint, spreadsheet, EPUB and RTF files, and nothing outside it; the user can choose another one in {}. {file_tools} {one_folder}",
            where_to_choose_the_project_folder(true)
        ),
        (Some(root), _) => format!(
            "Project folder: {root} - the open document's own folder, the default. You can read its text files and its PDF, Word, PowerPoint, spreadsheet, EPUB and RTF files, and nothing outside it; the user can choose another one in {}. {file_tools} {one_folder}",
            where_to_choose_the_project_folder(true)
        ),
        (None, RootSource::TooBroad) => format!("Project folder: none - the document's folder is the user's home folder or a whole drive, which is too broad to open to you, so you can't read any files, and there is no project menu. If the user refers to a file, say so, ask them to paste what you need, and tell them they can choose a narrower project folder in {}.", where_to_choose_the_project_folder(false)),
        (None, _) => format!("Project folder: none - the document isn't saved yet and no folder has been chosen, so you can't read any files, and the project bar and its menu don't appear until there is a project folder. If the user refers to a file, say that this is why, ask them to paste what you need, and tell them that saving the document next to their files, or choosing a project folder in {}, lets you read them.", where_to_choose_the_project_folder(false)),
    };
    let names = match UiNames::of(ui_language) {
        Some(ui) => {
            let rows = ui
                .names
                .iter()
                .map(|(en, name)| format!("{en} | {name}"))
                .collect::<Vec<_>>()
                .join("\n");
            let UiLanguage {
                english, native, ..
            } = ui.language;
            format!(
                "The app's names for things in the {english} UI the user sees, beside the English ones - use these when you reply in {english}, and never add a name from another language, in parentheses or otherwise (not \"style profile ({})\", not \"{} (library)\"); Settings paths keep their \" > \" and {AI_NAME}:\nEnglish | {native}\n{rows}",
                ui.of_english("style profile"),
                ui.of_english("library"),
            )
        }
        None => String::new(),
    };
    // The app guide is loaded on demand where use_skill can load it: it was
    // ~900 tokens of every request, for the few that ask about the app.
    let guide = if workspace.has_usable_skills() {
        format!("{APP_GUIDE_POINTER}\n")
    } else {
        format!("{}\n", app_guide())
    };
    format!("---project---\n{folder}\n{guide}{names}")
}

/// What `use_skill` loads as `app-guide`: what the app calls the things
/// that shape the agent's work, where they are, and how to answer a how-to
/// question (docs/design/ai-concepts.md).
pub(crate) const APP_GUIDE: &str = "app-guide";

/// What the system prompt says in place of the app guide.
const APP_GUIDE_POINTER: &str = "Textus's own features - the project folder and its .textus/ folder, the writing instructions (agent.md), skills, the library, the style profile, writing conventions, completion, what you remember and the panel's modes - are described in the app guide. Before you answer a question about using Textus or tell the user where one of them is or what it does, load it with use_skill app-guide and answer from it.";

/// The app guide (see APP_GUIDE).
pub(crate) fn app_guide() -> String {
    format!(
        "What the app calls the things that shape your work, in its English UI: the project folder, whose .textus/ folder holds the project's own settings. The writing instructions: agent.md files in the global config folder and in .textus/, shown to you under ---user instructions--- headings and used only in conversations; the global ones open from Settings > {AI_NAME} > Writing Instructions (agent.md) > Edit agent.md, the project's from Edit project writing instructions in the project menu. Skills: reusable instructions the user calls with /name, or that you load when a request matches one, each one Markdown file - a name and a one-line description at the top, then the instructions. The app ships built-in skills, listed in Settings > {AI_NAME} > Built-in skills, where each has a switch to turn it off and Customize…, which copies it into the global config folder's skills/ and opens the copy to edit (Reset deletes the copy and brings the built-in back); the user's own skills go in .textus/skills/ or in the global config folder's skills/ (Settings > {AI_NAME} > Skills > Import Skill… copies a file there), and one with a built-in skill's name replaces it. The library: one file per person, place or term in .textus/library, an entry sent to you whenever its name or an alias appears in the user's message or the open document (aliases go on an `aliases:` line at the top of the entry); New library entry… in the project menu starts one. The style profile: .textus/style.md, sent to you as ---the author's style profile---; Learn my style from samples… in the project menu drafts it from the user's own writing (\"Learn my style\"), Create style profile starts an empty one, and once it exists Open style profile in the menu, or the Style chip next to the folder name, opens it. Writing conventions (Settings > {AI_NAME}, under Writing Assistance) picks the punctuation, spacing and number norms you, the grammar check and check_conventions follow - Automatic, or one profile such as en-GB/govuk for documents in that language; a `conventions:` line in the style profile's front matter overrides it for the project. The style profile and the library also shape completion, the grey suggestions as the user types; Enable AI completion in Settings > {AI_NAME}, under Writing Assistance, turns completion on or off, and Completion tone there sets its register. What you remember: what you keep with the remember tool, one small file each - the user's personal memories in the global config folder's memory/, the project's in .textus/memory/, facts about the work as library entries - shown with Undo under your reply and listed in the AI panel's Memory tab, where the user can edit, delete or move each one; Remember automatically in Settings > {AI_NAME} turns it on or off. The panel's modes are Write, which drafts new text into the document, Review, which only reads and comments, and Revise, which proposes changes to the text already there; the user applies a proposal with Accept or drops it with Reject.\nAsked how to do something in the app, answer in two to four plain sentences: what to use, where it is and what it does - for a skill, first a built-in skill that already does it (named as their UI names it) and Customize… to adapt it, before writing one from scratch - no headings or code blocks, no tips they didn't ask for, and no remarks about their document or their files."
    )
}

/// Up to this much the document is embedded in full; past it, the prompt
/// gets a line-numbered outline plus a head/tail excerpt (and the section
/// the user is working in), and the model reads what it needs through
/// read_document / search_document (tools.rs), which always work on the
/// full text. Raised from 16k: that cut ordinary chapters down to 3k
/// characters of visible text, and the Anthropic path now caches the
/// prompt across tool steps. Counted in characters with Chinese, Japanese
/// and Korean ones as 3 (project::char_units, as read_file counts) where
/// the model can read on: by characters, a Chinese chapter of 39,000 was
/// sent whole, about 40,000 tokens in every message (docs/design/ai-tokens.md,
/// item 3). Without tools there is no reading on, so characters it stays.
const FULL_DOCUMENT_LIMIT: usize = 40_000;
const EXCERPT_CHARS: usize = 2_000;
const MAX_OUTLINE_HEADINGS: usize = 120;

/// The document's headings with the line each starts on (`L12 ## Methods`)
/// - the map read_document's line ranges and section names refer to.
fn heading_outline(document: &str) -> Vec<String> {
    let lines: Vec<&str> = document.lines().collect();
    crate::ai::tools::heading_lines(&lines)
        .into_iter()
        .take(MAX_OUTLINE_HEADINGS)
        .map(|(i, _)| format!("L{} {}", i + 1, lines[i].trim()))
        .collect()
}

/// Char-count (not byte) prefix/suffix - document content is arbitrary
/// UTF-8 (CJK text especially), so a naive byte slice could land mid-char.
fn char_prefix(s: &str, n: usize) -> &str {
    s.char_indices().nth(n).map_or(s, |(i, _)| &s[..i])
}

fn char_suffix(s: &str, n: usize) -> &str {
    let total = s.chars().count();
    if total <= n {
        return s;
    }
    s.char_indices().nth(total - n).map_or(s, |(i, _)| &s[i..])
}

/// The `---document---` prompt section: the full text under
/// `FULL_DOCUMENT_LIMIT`, otherwise an outline plus start/end excerpts.
/// Most of a focus section embedded alongside a truncated document.
const FOCUS_SECTION_CHARS: usize = 12_000;

/// The section headed `heading` (to the next heading at its level or above)
/// and the line it starts on - the part of a long document the user is
/// working in, which the truncated view would otherwise leave out.
fn focus_section(document: &str, heading: &str) -> Option<(usize, String)> {
    let lines: Vec<&str> = document.lines().collect();
    let (first, last) = crate::ai::tools::section_range(&lines, heading)?;
    let text = lines[first..last].join("\n");
    Some((
        first + 1,
        char_prefix(&text, FOCUS_SECTION_CHARS).to_string(),
    ))
}

pub(crate) fn document_section(
    document: &str,
    with_tools: bool,
    focus_heading: Option<&str>,
) -> String {
    let len = document.chars().count();
    let size = if with_tools {
        document.chars().map(crate::ai::project::char_units).sum()
    } else {
        len
    };
    if size <= FULL_DOCUMENT_LIMIT {
        return format!("---document---\n{document}");
    }
    let focus = focus_heading
        .and_then(|h| focus_section(document, h))
        .map(|(line, text)| {
            format!("\n\n[the section the user is working in, from line {line}]\n{text}")
        })
        .unwrap_or_default();
    let outline = heading_outline(document);
    let outline_block = if outline.is_empty() {
        "(no headings)".to_string()
    } else {
        outline.join("\n")
    };
    let note = if with_tools {
        "This document is long, so only an outline (with line numbers) and the start/end are shown below. Read any section in full with read_document (by heading or line range) before revising or quoting it, and use search_document to find where something is mentioned."
    } else {
        "This document is long, so only an outline and the start/end are shown below - some content in the middle isn't visible here."
    };
    format!(
        "---document (truncated, {len} chars, {} lines total)---\n{note}\n\n[outline]\n{outline_block}{focus}\n\n[start]\n{}\n\n[end]\n{}",
        document.lines().count(),
        char_prefix(document, EXCERPT_CHARS),
        char_suffix(document, EXCERPT_CHARS),
    )
}

/// The conversation's mode, picked in the composer. Mirrors `AgentMode` in
/// src/settings/SettingsContext.tsx. It decides what propose_edit may do
/// (tools::builtin_tools) and what the prompt says the user is here for.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentMode {
    /// Reads, answers and comments: no propose_edit.
    Review,
    /// Changes the text that is there: every propose_edit action.
    Revise,
    /// Only adds new text: propose_edit limited to the insertion actions.
    Write,
}

impl std::fmt::Display for AgentMode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            AgentMode::Review => "review",
            AgentMode::Revise => "revise",
            AgentMode::Write => "write",
        })
    }
}

/// The static half of the layering: role + writing instructions + skill
/// index (+ the document, tool-less) go into the system prompt; skill bodies
/// and project files stay out of it and are pulled in dynamically through
/// tools.
pub(crate) fn build_instructions(
    workspace: &AgentWorkspace,
    document: &str,
    with_tools: bool,
    mode: AgentMode,
    // What the request is about (the user's message) - library entries are
    // picked by what it and the document mention.
    focus: &str,
    // The language the app's UI is in (a code of src/i18n/langs.ts), whose
    // names for things the agent is given beside the English ones.
    ui_language: &str,
) -> String {
    let mut sections = vec![AGENT_ROLE.to_string()];
    // Tool-less, everything goes in the system prompt; with tools, what
    // changes from request to request comes with the message instead (see
    // request_preamble), so a switch between Write and Revise, or a memory
    // saved, leaves the cached prefix as it was.
    if !with_tools {
        sections.push(mode_section(mode, ui_language));
    }

    if with_tools {
        sections.push(
            if mode == AgentMode::Review {
                AGENT_READ_ONLY_TOOL_INSTRUCTIONS
            } else {
                AGENT_TOOL_INSTRUCTIONS
            }
            .to_string(),
        );
        sections.push(RULES_TOOL_INSTRUCTIONS.to_string());
        sections.push(workspace_section(workspace, ui_language));
    }

    // The writing instructions (agent.md): global, then the project's - the
    // user's own standing rules: reply language, terminology, project
    // background. With both layers present the project's section says it
    // wins a conflict (docs/design/ai-concepts.md); a single layer keeps the plain
    // header the rest of the prompt refers to.
    for instructions in &workspace.instructions {
        sections.push(format!("---user instructions---\n{instructions}"));
    }
    if let Some(project) = &workspace.project_instructions {
        sections.push(if workspace.instructions.is_empty() {
            format!("---user instructions---\n{project}")
        } else {
            format!("---user instructions for this project (where they conflict with the ones above, follow these)---\n{project}")
        });
    }

    // What Textus AI remembered by itself (ai::memory): personal, then the
    // project's, after the user's own instructions, which win over both -
    // here only without tools; with them, how to remember stays here and
    // what is remembered comes with the message (request_preamble).
    if with_tools {
        sections.extend(crate::ai::memory::remember_instructions(
            workspace.root.is_some(),
            workspace.remember,
        ));
    } else {
        sections.extend(crate::ai::memory::memory_sections(
            &workspace.memories,
            &workspace.library,
            false,
        ));
    }

    // The skill index: names + descriptions only. Bodies load on demand via
    // use_skill, so a large skill library costs almost nothing per request.
    // /name-only skills (and turned-off built-ins) aren't offered.
    let index = skill_index(workspace, ui_language);
    if with_tools && !index.is_empty() {
        // A /name the user typed arrives already expanded in a <skill> block
        // (builtin::expand_message); loading it again cost a round trip of
        // 12-16 s in the live eval.
        sections.push(format!(
            "---available skills---\n{index}\nWhen a request matches a skill's description, in whatever language it is written, load it with use_skill and follow it, before you answer or ask for missing details. When a skill marked (project) or (yours) and an unmarked built-in skill both match a request, use the marked one. A <skill name=\"...\"> block in the user's message is that skill already loaded - follow it without calling use_skill for it; its own rules for the result (length, form, what to say) override the general ones above.\nReference packs, loaded only when a skill asks for them: {}. Add #section to load one section, e.g. standards-fr#dialogue.",
            crate::ai::builtin::reference_pack_names().join(", ")
        ));
    }

    // Tool-calling paths carry the document (and the writing context picked
    // by it) in the user's latest message instead - see request_context -
    // so this prompt stays byte-identical across a conversation and the
    // provider's prompt cache survives every accepted edit. The tool-less
    // fallback keeps it here: it sends one flattened turn anyway.
    if !with_tools {
        sections.push(request_context(workspace, document, false, focus, None));
    }
    sections.join("\n\n")
}

/// The `---interaction mode---` section: what the user is in the panel for.
/// Said in Write and Revise: text proposed and not decided yet is the
/// document as the user sees it. A second request used to edit the
/// document as saved under a first one's proposals - continuing before
/// them, or quoting their text as an anchor the document didn't have.
const UNDECIDED_TEXT: &str = "Text you proposed earlier that the user hasn't accepted or rejected yet is part of the document as they see it: to go on from it, insert_after its last sentence; to change or remove some of it, replace or delete with `anchor` quoted from it. The edit goes into that proposal.";

fn mode_section(mode: AgentMode, ui_language: &str) -> String {
    let ui = UiNames::of(ui_language);

    // The UI's names for the modes: told "read-only mode", the model
    // called it that and never said how to get the edit made.
    let named = |mode: &'static str, first: bool| match &ui {
        Some(ui) if first => format!(
            "{mode} mode ({} in their {} UI)",
            ui.of_english(mode),
            ui.language.english
        ),
        Some(ui) => format!("{mode} mode ({})", ui.of_english(mode)),
        None => format!("{mode} mode"),
    };
    match mode {
        AgentMode::Review => format!("---interaction mode: review---\nThe user is in {}: answer, explain, discuss or research, and pin feedback to passages with add_comment; you can't change the document here. When they ask for a change anyway, give the new text in your reply and say that in {} you can propose it for them to apply with one click - or, for new text added to the document, in {}.", named("Review", true), named("Revise", false), named("Write", false)),
        AgentMode::Revise => format!("---interaction mode: revise---\nThe user is in {}: carry out their request on the document - rewrite, tighten, fix, restructure, delete or add - and submit every document change through propose_edit so they can review it before applying. {UNDECIDED_TEXT}", named("Revise", true)),
        AgentMode::Write => format!("---interaction mode: write---\nThe user is in {}: draft new text into the document - continue it, or add a paragraph, section, list, scene or dialogue - through propose_edit, which in this mode only adds text (append, insert_at_cursor, insert_after, insert_before); the user reviews each proposal before it is applied. Where it goes: with a <selected-text> block, right after the selection - insert_after with the selection's last sentence (or the whole selection) as `anchor` - never in place of it; otherwise, with a <cursor> block in a document that has text, insert_at_cursor; in an empty document, append. Questions and feedback still get a plain reply. You can't change or remove text that is already there in this mode: when the user asks for that, say it needs {}, and add nothing in its place. {UNDECIDED_TEXT} That text is the one you may change here.", named("Write", true), named("Revise", false)),
    }
}

/// What a tool-calling request says before its context, rather than in the
/// system prompt: the mode, and what Textus AI remembers. Both change
/// within a conversation (the mode switch in the composer, a memory saved),
/// and in the system prompt each change rewrote the whole cached prefix and
/// history (docs/design/ai-tokens.md); here they cost only this message.
pub(crate) fn request_preamble(
    workspace: &AgentWorkspace,
    mode: AgentMode,
    ui_language: &str,
) -> String {
    let mut sections = vec![mode_section(mode, ui_language)];
    sections.extend(crate::ai::memory::memory_sections(
        &workspace.memories,
        &workspace.library,
        workspace.remember,
    ));
    sections.join("\n\n")
}

/// What the index says of a built-in skill: when to use it - its
/// description's "Use when ..." part, without the request words in eight
/// languages in parentheses, which the model doesn't need to route a
/// request in any of them (agent-builtin's route cases) and which were half
/// the index. What the skill does is in its instructions, loaded with it.
fn index_line(description: &str) -> String {
    let from = description.find("Use when").unwrap_or(0);
    let mut line = String::with_capacity(description.len() - from);
    let mut depth = 0usize;
    let mut group = String::new();
    for c in description[from..].chars() {
        match c {
            '(' => {
                depth += 1;
                group.push(c);
            }
            ')' if depth > 0 => {
                depth -= 1;
                group.push(c);
                if depth == 0 {
                    if group.is_ascii() {
                        line.push_str(&group);
                    } else if line.ends_with(' ') {
                        line.pop();
                    }
                    group.clear();
                }
            }
            _ if depth > 0 => group.push(c),
            _ => line.push(c),
        }
    }
    line.push_str(&group);
    line.trim().to_string()
}

/// Longest description the skill index shows; a longer one (a user's
/// skill) is cut with "…".
const INDEX_DESCRIPTION_CHARS: usize = 500;

/// The skill index the model sees: the skills it may load by description,
/// the user's own first (marked "(project)" or "(yours)"), then the
/// built-ins by menu category and name. A built-in carries the name the
/// user's UI gives it (its first alias there): told only "continuity", the
/// agent called it "the 连续性 skill" in a Chinese answer, a /name that
/// doesn't exist (round 4, concept/zh/library). Depends only on the
/// workspace and the UI language, so the system prompt stays byte-identical
/// across a conversation.
pub(crate) fn skill_index(workspace: &AgentWorkspace, ui_language: &str) -> String {
    use crate::ai::workspace::SkillSource;
    let mut offered: Vec<&crate::ai::workspace::AgentSkill> = workspace
        .skills
        .iter()
        .filter(|s| s.offered_to_model())
        .collect();
    let rank = |s: &crate::ai::workspace::AgentSkill| {
        let layer = match s.source {
            SkillSource::Project => 0,
            SkillSource::Global => 1,
            SkillSource::Builtin => 2,
        };
        let category = s
            .category
            .as_deref()
            .and_then(|c| {
                crate::ai::builtin::CATEGORY_ORDER
                    .iter()
                    .position(|o| *o == c)
            })
            .unwrap_or(crate::ai::builtin::CATEGORY_ORDER.len());
        (layer, category)
    };
    // Stable: the user's skills keep their file order.
    offered.sort_by(|a, b| {
        let (ra, rb) = (rank(a), rank(b));
        ra.cmp(&rb).then_with(|| {
            if ra.0 == 2 {
                a.name.cmp(&b.name)
            } else {
                std::cmp::Ordering::Equal
            }
        })
    });
    offered
        .iter()
        .map(|s| {
            let mark = match s.source {
                SkillSource::Project => " (project)".to_string(),
                SkillSource::Global => " (yours)".to_string(),
                SkillSource::Builtin => match s.aliases.get(ui_language).and_then(|a| a.first()) {
                    Some(label) if ui_language != "en" => format!(" [/{label} in their UI]"),
                    _ => String::new(),
                },
            };
            let description = match s.source {
                SkillSource::Builtin => index_line(&s.description),
                _ => s.description.clone(),
            };
            let description = if description.chars().count() > INDEX_DESCRIPTION_CHARS {
                format!(
                    "{}…",
                    description
                        .chars()
                        .take(INDEX_DESCRIPTION_CHARS - 1)
                        .collect::<String>()
                )
            } else {
                description
            };
            format!("- {}{mark}: {description}", s.name)
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// The per-request context: the project's style profile and the library
/// entries this request touches, then the document (in full, or outlined
/// when long). Prepended to the CURRENT user message only, for the request;
/// what history keeps is the plain message (see ai_agent_message_inner), so
/// earlier turns never repeat an old copy of the document.
pub(crate) fn request_context(
    workspace: &AgentWorkspace,
    document: &str,
    with_tools: bool,
    focus: &str,
    // The heading of the section the cursor or selection is in, from the
    // editor - included in full when the document is too long to embed.
    focus_heading: Option<&str>,
) -> String {
    request_context_and_library(workspace, document, with_tools, focus, focus_heading).0
}

/// [`request_context`], and the library entries it carries and leaves out
/// - which the Memory tab marks (project::record_library_use).
fn request_context_and_library<'a>(
    workspace: &'a AgentWorkspace,
    document: &str,
    with_tools: bool,
    focus: &str,
    focus_heading: Option<&str>,
) -> (String, crate::ai::project::LibraryPick<'a>) {
    let document_text = document_section(document, with_tools, focus_heading);
    let pick =
        crate::ai::project::pick_library(&workspace.library, &format!("{focus}\n{document_text}"));
    let mut parts: Vec<String> =
        crate::ai::project::writing_context_section(workspace.style.as_deref(), &pick.included)
            .into_iter()
            .collect();
    parts.push(document_text);
    (parts.join("\n\n"), pick)
}

/// The current user message as sent: the request context, then what the
/// user wrote - under a header that names the language they wrote it in,
/// when that can be told. The rule "reply in the language of the user's
/// message" alone lost to the document's language whenever a short English
/// request came with a Chinese or Japanese document: the whole reply came
/// back in the document's language (round 4: cross/en-asks-ja-doc, and
/// Haiku replying in English to Chinese requests once a style profile was
/// in the context). Said right above the message, per turn, it holds.
pub(crate) fn request_user_text(context: &str, message: &str) -> String {
    match message_language(message) {
        Some(language) => format!(
            "{context}\n\n---the user's message (written in {language}: reply in {language}, unless the user instructions set a reply language)---\n{message}"
        ),
        None => format!("{context}\n\n---the user's message---\n{message}"),
    }
}

/// The current user message on the tool path: the preamble (the mode, what
/// Textus AI remembers), the request context, then what the user wrote.
pub(crate) fn request_message(
    workspace: &AgentWorkspace,
    mode: AgentMode,
    ui_language: &str,
    context: &str,
    message: &str,
) -> String {
    let mut preamble = request_preamble(workspace, mode, ui_language);
    if mode != AgentMode::Review && asks_for_a_length(message) {
        preamble.push_str("\n\n");
        preamble.push_str(LENGTH_TARGET_NOTE);
    }
    request_user_text(&format!("{preamble}\n\n{context}"), message)
}

/// Said with a request that asks for a length. Told only in the system
/// prompt, Doubao still wrote a 1200-character piece out in measure_text,
/// unseen, before proposing it - the user waited minutes for the first
/// word; said next to the request, it proposes straight away.
const LENGTH_TARGET_NOTE: &str = "This request asks for a length: write the text straight into propose_edit, where the user watches it come in - don't write it out first in measure_text or check_conventions. propose_edit's result says how long it came out; if that misses the length, say so in your reply.";

/// Whether the user's own words ask for a length: a number and a unit of
/// text ("1200 字", "500 words", "三千字", "2,000 characters").
fn asks_for_a_length(message: &str) -> bool {
    static LENGTH: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
        regex::Regex::new(
            r"(?i)([0-9][0-9,]*|[一二两三四五六七八九十百千万]+)\s*(?:个)?\s*(?:字|词|words?\b|characters?\b|chars?\b|文字|語|단어|자\b|mots?\b|palabras?\b|wörter\b|слов)",
        )
        .expect("a valid pattern")
    });
    LENGTH.is_match(message)
}

/// The language of what the user typed, in English ("Chinese"), or None
/// when there is too little of it to tell. Text the message carries but the
/// user didn't write - a selection, the text around the cursor, attached
/// files, an expanded skill's instructions - is left out.
pub(crate) fn message_language(message: &str) -> Option<&'static str> {
    let mut typed = message.to_string();
    for (open, close) in [
        ("<skill name=", "</skill>"),
        ("<selected-text>", "</selected-text>"),
        ("<cursor>", "</cursor>"),
        ("<attached-file", "</attached-file>"),
    ] {
        while let Some(start) = typed.find(open) {
            let Some(end) = typed[start..].find(close).map(|i| start + i + close.len()) else {
                typed.truncate(start);
                break;
            };
            typed.replace_range(start..end, " ");
        }
    }
    let lang = crate::ai::rules::detect::guess(&typed)?;
    // The script is part of the language: asked in Simplified to convert a
    // report to Traditional, the reply came back in Traditional (round 4,
    // builtin/translate/hans-hant/report).
    if lang == crate::ai::rules::detect::Lang::ZhHans {
        return Some("Simplified Chinese");
    }
    let code = lang.ui_code();
    crate::ai::ui_language::UI_LANGUAGES
        .iter()
        .find(|l| l.code == code)
        .map(|l| l.english)
}

/// Tool output from an earlier exchange longer than this is cut to a stub
/// before being replayed: a file or section read three questions ago is
/// rarely needed again, and re-sending it with every request is most of what
/// made long conversations slow, expensive and finally too big to send.
const OLD_TOOL_OUTPUT_LIMIT: usize = 1_500;
const OLD_TOOL_OUTPUT_KEEP: usize = 400;
/// Past this much replayed history (characters), whole exchanges are dropped
/// oldest first, so a long session degrades into forgetting its beginning
/// instead of failing every send once it no longer fits the context window.
const HISTORY_BUDGET: usize = 150_000;
/// Exchanges are dropped in blocks of at least this many characters, counted
/// from the start of the conversation. Dropping just enough for each send
/// moved the history's first message every turn once over budget, and with
/// it every byte of the prompt cache; a block boundary depends only on the
/// exchanges before it, so the start now stays put until the conversation
/// has grown by another block. Never more than two blocks beyond what the
/// budget needs, though (see compact_history).
const HISTORY_DROP_STEP: usize = HISTORY_BUDGET / 3;

fn turn_chars(turn: &AgentTurn) -> usize {
    match turn {
        AgentTurn::User { text, .. } | AgentTurn::Assistant { text, .. } => text.len(),
        AgentTurn::ToolCall { arguments, .. } => arguments.len(),
        AgentTurn::ToolResult { output, .. } => output.len(),
    }
}

/// Shrinks the replayed conversation (everything before the message being
/// sent) to what a writing agent still needs from it. propose_edit results
/// are never cut - they carry the accepted/rejected status notes the model
/// relies on. Edits nothing the user sees: the frontend keeps the full
/// history; only what goes to the provider is trimmed.
///
/// Both cuts are made the same way on every send, so a turn reads the same
/// from the first request that replays it to the last: a tool result is cut
/// to the same stub each time, and the oldest exchanges go in fixed blocks
/// (HISTORY_DROP_STEP). That is what lets the provider's prompt cache cover
/// the whole history (see anthropic.rs's cache breakpoints) - the only bytes
/// that change are the current message's, which carries the document.
pub(crate) fn compact_history(history: Vec<AgentTurn>) -> Vec<AgentTurn> {
    let tool_names: std::collections::HashMap<String, String> = history
        .iter()
        .filter_map(|turn| match turn {
            AgentTurn::ToolCall { call_id, name, .. } => Some((call_id.clone(), name.clone())),
            _ => None,
        })
        .collect();
    let mut turns: Vec<AgentTurn> = history
        .into_iter()
        .map(|turn| match turn {
            AgentTurn::ToolResult {
                call_id,
                output,
                images,
            } if output.chars().count() > OLD_TOOL_OUTPUT_LIMIT
                    && tool_names.get(&call_id).map(String::as_str) != Some("propose_edit") =>
            {
                let omitted = output.chars().count() - OLD_TOOL_OUTPUT_KEEP;
                let output = format!(
                    "{}\n[... {omitted} more characters of this earlier result omitted to save space - call the tool again if you need them]",
                    char_prefix(&output, OLD_TOOL_OUTPUT_KEEP)
                );
                AgentTurn::ToolResult {
                    call_id,
                    output,
                    images,
                }
            }
            turn => turn,
        })
        .collect();

    let total: usize = turns.iter().map(turn_chars).sum();
    if total <= HISTORY_BUDGET {
        return turns;
    }
    // Cut only where an exchange starts (at a user turn): dropping whole
    // exchanges keeps every tool call paired with its result. Each start
    // with the characters before it.
    let mut starts = Vec::new();
    let mut before = 0;
    for (i, turn) in turns.iter().enumerate() {
        if i > 0 && matches!(turn, AgentTurn::User { .. }) {
            starts.push((i, before));
        }
        before += turn_chars(turn);
    }
    // The fewest exchanges that must go: up to the first start that leaves
    // the rest within budget, else all but the newest, as large as it is.
    let Some(&(needed, needed_before)) = starts
        .iter()
        .find(|&&(_, before)| total - before <= HISTORY_BUDGET)
        .or(starts.last())
    else {
        return turns;
    };
    // Rounded up to the end of its block, which drops under two blocks more
    // than must go while exchanges are small next to a block. One carrying
    // a long attachment (inlined into its message) can be bigger than a
    // block, and rounding past it would leave a fraction of the budget:
    // then just what must go, the way it was before blocks.
    let mut cut = needed;
    let mut block_start = 0;
    for &(i, before) in &starts {
        if before - block_start < HISTORY_DROP_STEP {
            continue;
        }
        block_start = before;
        if i >= needed {
            if before - needed_before <= 2 * HISTORY_DROP_STEP {
                cut = i;
            }
            break;
        }
    }
    turns.drain(..cut);
    turns
}

/// Sends one user message and runs the conversation forward, returning the
/// new turns produced (the user's own turn, any tool calls/results, and the
/// final assistant reply) for the frontend to append to its history.
///
/// Tool calling runs for every dialect `aicompat::providers::AgentProvider`
/// has a step for: openai-responses, anthropic-messages, and
/// openai-chat-completions (the generic dialect most self-hosted/proxy
/// servers speak - OpenRouter, Groq, Ollama, and friends, plus "custom").
/// The chat-completions dialect additionally falls back to
/// `flattened_chat_turn` on a hard failure, since not every compatible
/// server actually implements `tools` correctly. A provider with no dialect
/// at all falls straight to `flattened_chat_turn`, a single non-agentic
/// completion (with the writing instructions still in the system prompt;
/// skills reach them via the frontend's /name injection instead of
/// use_skill). The orchestration loop (`run_agent_loop`), the tool
/// implementations (`crate::ai::tools`) and the one path below that
/// prepares them don't know which dialect is in play - tool-calling support
/// for another provider is an `Endpoint` and its arm in `AgentProvider`.
/// `model` is the user's Settings choice, or None for the provider default.
// Each parameter is a distinct invoke() payload key - bundling them into a
// struct would only move the width into the frontend call site.
/// Thin wrapper around `ai_agent_message_inner` that races it against a
/// cancellation signal (the chat "stop" button - see `ai::cancel`).
/// `request_id` is frontend-generated and only meaningful for the duration
/// of this one call, so it's registered and torn down here rather than
/// threaded into the request logic below.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn ai_agent_message(
    app: AppHandle,
    provider: String,
    document: String,
    doc_path: Option<String>,
    // `workspace_root`: the chosen project folder. None keeps the default -
    // the document's own folder (see workspace::load).
    workspace_root: Option<String>,
    history: Vec<AgentTurn>,
    message: String,
    // `images`: attachments with no text to extract. The text-shaped ones
    // (PDF, Word, spreadsheets) were already extracted and inlined into
    // `message` by the frontend; only images travel as their own parts.
    images: Vec<ImageAttachment>,
    web_search: bool,
    // How hard the model thinks (capabilities::ThinkingLevel): Deep when
    // the composer's Deep thinking is on, Fast from Quick Ask. None - an
    // older frontend - is Auto, the provider's default.
    thinking: Option<ThinkingLevel>,
    // Settings > Textus AI > Search service: "auto" (None from an older
    // frontend) or a service id, and the SearXNG server address - what
    // web_search uses when the model has no search of its own (ai::web).
    search_service: Option<String>,
    searxng_url: Option<String>,
    mode: AgentMode,
    model: Option<String>,
    request_id: String,
    // Heading of the section the user is working in (see request_context).
    focus_heading: Option<String>,
    // The UI language (src/i18n/langs.ts), for the names the agent is told
    // the app uses (UiNames). None - an older frontend - is English.
    ui_language: Option<String>,
    // The conversation (`{id, title}`), recorded with what Textus AI
    // remembers in it (ai::memory). None from an older frontend.
    conversation: Option<crate::ai::memory::Source>,
    // The image model (Settings › Textus AI › Image model); None for none,
    // and from an older frontend. See ai::images.
    image_model: Option<crate::ai::images::ImageModel>,
    on_event: Channel<StreamEvent>,
) -> Result<Vec<AgentTurn>, String> {
    crate::ai::ensure_on(&app)?;
    let web_service = web_search
        .then(|| web::resolve_service(&app, search_service.as_deref(), searxng_url.as_deref()))
        .flatten();
    let ui_language = ui_language.unwrap_or_else(|| "en".to_string());
    let source = crate::ai::memory::Source {
        document: doc_path.clone(),
        ..conversation.unwrap_or_default()
    };
    cancel::cancellable(
        request_id,
        ai_agent_message_inner(
            app,
            provider,
            document,
            doc_path,
            workspace_root,
            history,
            message,
            images,
            web_search,
            web_service,
            thinking.unwrap_or_default(),
            mode,
            model,
            focus_heading,
            ui_language,
            source,
            image_model,
            on_event,
        ),
    )
    .await
}

#[allow(clippy::too_many_arguments)]
async fn ai_agent_message_inner(
    app: AppHandle,
    provider: String,
    document: String,
    doc_path: Option<String>,
    // `workspace_root`: the chosen project folder. None keeps the default -
    // the document's own folder (see workspace::load).
    workspace_root: Option<String>,
    history: Vec<AgentTurn>,
    message: String,
    images: Vec<ImageAttachment>,
    web_search: bool,
    web_service: Option<web::search::Service>,
    thinking: ThinkingLevel,
    mode: AgentMode,
    model: Option<String>,
    focus_heading: Option<String>,
    ui_language: String,
    source: crate::ai::memory::Source,
    image_model: Option<crate::ai::images::ImageModel>,
    on_event: Channel<StreamEvent>,
) -> Result<Vec<AgentTurn>, String> {
    let workspace = workspace::load(&app, doc_path.as_deref(), workspace_root.as_deref());
    let conventions = crate::ai::conventions::for_workspace(&app, &workspace);
    let library = crate::ai::conventions::library_names(&workspace);
    // Where the remember tool writes, while Remember automatically is on.
    let memory = workspace
        .remember
        .then(|| crate::ai::memory::MemoryContext {
            dirs: crate::ai::memory::MemoryDirs::new(
                workspace::global_agent_dir(&app).ok().as_deref(),
                workspace.root.as_deref().map(Path::new),
            ),
            source,
        });
    // What the request is about, for picking library entries: the message
    // as the user's side sent it, before the reference packs go in.
    let focus = message.clone();
    // A /name call gets the skill's instructions and reference packs filled
    // in here, and history keeps the expanded message (see expand_message).
    let message = crate::ai::builtin::expand_message_with(
        &message,
        &workspace.skills,
        &document,
        &ui_language,
        crate::ai::builtin::chosen_profile(&conventions, &document).as_deref(),
    );
    let entry = catalog::find(&provider).ok_or_else(|| format!("unknown provider: {provider}"))?;
    // Numbered on from the sources earlier replies cited - so from the
    // history as it came, before it is cut down for sending.
    let web_plan = WebPlan::new(
        web_search,
        web::native_search(
            &provider,
            model
                .as_deref()
                .or(entry.agent_default_model)
                .unwrap_or_default(),
        ),
        web_service,
        &history,
    );
    let web = &web_plan;
    let history = compact_history(web::with_sources_in_text(history));

    // A selected picture is shown to a model that can see, not only its
    // Markdown: "what's in this picture", "redo it brighter".
    let mut images = images;
    if entry.supports_vision {
        images.extend(selected_picture(&focus, doc_path.as_deref()));
    }
    // Refuse rather than drop. Sending the images to a provider that can't
    // read them would get an answer confidently written about a picture the
    // model never saw - the frontend hides the attach affordance for these
    // providers, so reaching here means something got out of step.
    if !images.is_empty() && !entry.supports_vision {
        return Err(format!(
            "{} can't read images. Remove the image, or switch provider in Settings > {AI_NAME}.",
            entry.label
        ));
    }
    // Tool-calling paths: the document rides in this message (see
    // build_instructions). The tool-less fallback rebuilds its own turn.
    let (context, sent_library) = request_context_and_library(
        &workspace,
        &document,
        true,
        &focus,
        focus_heading.as_deref(),
    );
    crate::ai::project::record_library_use(doc_path.as_deref(), &sent_library);
    let user_turn = AgentTurn::User {
        text: request_message(&workspace, mode, &ui_language, &context, &message),
        images,
    };
    let plain_message = message.clone();
    // generate_image, while an image model is set.
    let image_run = crate::ai::images::ImageRun::resolve(&app, image_model.as_ref(), entry.id);

    let agent = route::agent_provider(&app, entry, model.clone(), thinking, web.native).await?;
    let result = match agent {
        Some(agent) => {
            let instructions = with_web_section(
                build_instructions(&workspace, &document, true, mode, &focus, &ui_language),
                web,
            );
            // The text of proposals still undecided from earlier requests:
            // an edit or a picture may go into it (ai::images, tools.rs's
            // propose_edit).
            let undecided = crate::ai::images::undecided_texts(&history);
            let tool_ctx = ToolContext {
                document: &document,
                undecided: &undecided,
                skills: &workspace.skills,
                ui_language: &ui_language,
                root: workspace.root.as_deref().map(Path::new),
                sees_images: entry.supports_vision,
                conventions: &conventions,
                library: &library,
                memory: memory.as_ref(),
                proposed: Default::default(),
                checks: Default::default(),
            };
            let mut tools = ToolRegistry::builtin(
                workspace.has_usable_skills(),
                workspace.root.is_some(),
                mode,
                workspace.remember,
                entry.supports_vision,
            );
            if let Some(image_run) = &image_run {
                tools.add(image_run.tool(
                    &document,
                    crate::ai::images::ProposedText {
                        this_request: &tool_ctx.proposed,
                        undecided: &undecided,
                    },
                    &on_event,
                ));
            }
            for tool in web.tools(&focus) {
                tools.add(tool);
            }
            // Pictures written into the text, begun as their lines stream in.
            let inline = image_run.as_ref().map(|run| run.inline(&tool_ctx.proposed));
            let tool_specs = tools.specs();
            let step = |turns: Vec<AgentTurn>| {
                let (agent, instructions, tool_specs) = (&agent, &instructions, &tool_specs);
                let channel = on_event.clone();
                let inline = inline.as_ref();
                async move {
                    let sink = move |e: ProviderEvent<'_>| forward(&channel, web, inline, e);
                    agent
                        .step(instructions, &turns, tool_specs, &sink)
                        .await
                        .map(|(step, _)| step)
                }
            };
            let step = with_postfix(step, &document, &conventions, web, inline.as_ref());
            // `history` is cloned so the plain-chat fallback below still has
            // it; `run_agent_loop` would otherwise have consumed it.
            match run_agent_loop(
                history.clone(),
                user_turn,
                MAX_STEPS,
                step,
                |call| tools.execute(&tool_ctx, call),
                |name| tools.how_to_run(name),
                report(&on_event),
            )
            .await
            {
                // A server that doesn't implement `tools` properly
                // (AgentProvider::falls_back_to_plain_chat) gets a single
                // tool-less completion instead of failing the request.
                Err(_) if agent.falls_back_to_plain_chat() => {
                    let instructions = build_instructions(
                        &workspace,
                        &document,
                        false,
                        mode,
                        &focus,
                        &ui_language,
                    );
                    // No tools here, so no web_search: the user's message
                    // is searched up front instead.
                    let instructions = match web.search_ahead(&focus).await {
                        Some(results) => format!("{instructions}\n\n{results}"),
                        None => instructions,
                    };
                    flattened_chat_turn(
                        &app,
                        &provider,
                        &instructions,
                        history,
                        message,
                        Some(&agent.model),
                    )
                    .await
                }
                result => result,
            }
        }
        None => {
            let instructions =
                build_instructions(&workspace, &document, false, mode, &focus, &ui_language);
            flattened_chat_turn(
                &app,
                &provider,
                &instructions,
                history,
                message,
                model.as_deref(),
            )
            .await
        }
    };
    // What history keeps is the message as the user wrote it - the document
    // copy was for this request only, and replaying it in every later
    // request would multiply the prompt by the number of turns.
    result.map(|turns| {
        let mut turns: Vec<AgentTurn> = turns.into_iter().map(for_history).collect();
        if let Some(AgentTurn::User { text, .. }) = turns.first_mut() {
            *text = plain_message;
        }
        web.attach_sources(&mut turns);
        turns
    })
}

/// A turn as the frontend keeps it: a tool result without the images it
/// showed the model, which were for this request only - base64 in the saved
/// chat history would grow it by megabytes a picture, as the frontend's own
/// note on a user turn's images says (useAgentConversation.ts). The result
/// says so, so a later request that needs the picture opens it again.
fn for_history(turn: AgentTurn) -> AgentTurn {
    match turn {
        // The step's reasoning was for this exchange's own requests: no
        // provider wants it back in a later one, and it never shows.
        AgentTurn::ToolCall {
            call_id,
            name,
            arguments,
            reasoning: Some(_),
        } => AgentTurn::ToolCall {
            call_id,
            name,
            arguments,
            reasoning: None,
        },
        AgentTurn::ToolResult {
            call_id,
            output,
            images,
        } if !images.is_empty() => AgentTurn::ToolResult {
            call_id,
            output: format!(
                "{output}\n[The image was shown for that request only - call view_image again to look at it.]"
            ),
            images: Vec::new(),
        },
        turn => turn,
    }
}

/// Providers without tool-calling support get the conversation flattened
/// into a single plain-text turn and answered with one non-agentic
/// completion call.
async fn flattened_chat_turn(
    app: &AppHandle,
    provider: &str,
    instructions: &str,
    history: Vec<AgentTurn>,
    message: String,
    model: Option<&str>,
) -> Result<Vec<AgentTurn>, String> {
    fn turn_to_plain_text(turn: &AgentTurn) -> Option<String> {
        match turn {
            // Images are dropped here on purpose: this path exists for
            // providers with no tool calling and no vision, and the command
            // has already refused an image-carrying message for those.
            AgentTurn::User { text, .. } => Some(format!("User: {text}")),
            AgentTurn::Assistant { text, .. } => Some(format!("Assistant: {text}")),
            _ => None,
        }
    }

    let user_turn = AgentTurn::User {
        text: message,
        images: Vec::new(),
    };
    let mut transcript: Vec<String> = history.iter().filter_map(turn_to_plain_text).collect();
    if let Some(t) = turn_to_plain_text(&user_turn) {
        transcript.push(t);
    }

    let text = crate::ai::client::call(
        app,
        provider,
        instructions.to_string(),
        transcript.join("\n\n"),
        model,
    )
    .await?;
    Ok(vec![user_turn, AgentTurn::assistant(text)])
}

/// The picture a message's selection is, when it is one picture and
/// nothing else (`<selected-text>`, src/ai/chat/user-message.ts) whose
/// file is in the document's folder: PNG, JPEG, GIF or WebP, as view_image
/// reads them. None for a picture on the web, one outside the folder, or
/// a selection of anything more.
fn selected_picture(message: &str, doc_path: Option<&str>) -> Option<ImageAttachment> {
    let inner = message
        .strip_prefix("<selected-text>")?
        .split_once("</selected-text>")?
        .0
        .trim();
    let rest = inner.strip_prefix("![")?;
    let (_, src) = rest.split_once("](")?;
    let src = src.strip_suffix(')')?;
    // A title after the src, `![alt](src "title")`, goes.
    let src = src.split(" \"").next()?.trim();
    let src = src
        .strip_prefix('<')
        .and_then(|s| s.strip_suffix('>'))
        .unwrap_or(src);
    if src.is_empty() || src.contains("://") || src.starts_with("data:") {
        return None;
    }
    let folder = Path::new(doc_path?).parent()?;
    crate::ai::project::read_image(folder, src).ok()
}

#[cfg(test)]
mod tests {
    #[test]
    fn a_length_the_user_asks_for_is_noticed() {
        for asked in [
            "写一篇 1200 字左右的文章",
            "写三千字",
            "Write about 500 words on tides",
            "2,000 characters, please",
            "800字以内",
        ] {
            assert!(asks_for_a_length(asked), "{asked}");
        }
        for other in ["写一篇文章，配两张图", "Fix the 3 typos", "第2段"] {
            assert!(!asks_for_a_length(other), "{other}");
        }
    }

    use super::*;
    use crate::ai::ui_language::{entries, UI_LANGUAGES};

    /// The whole tool path a writing request takes, with a scripted model:
    /// read the section it was asked about, propose an edit quoting it,
    /// get told when a quote doesn't match, retry with the right one.
    #[test]
    fn scripted_agent_reads_then_proposes_through_the_real_tools() {
        use aicompat::agent::StepResult;
        use std::cell::RefCell;
        use std::collections::VecDeque;

        let document = "# Notes\n\n## Methods\n\nWe sampled ten sites.\n\n## Results\n\nAll good.";
        let tools = ToolRegistry::builtin(false, false, AgentMode::Revise, false, false);
        let conventions = crate::ai::rules::Conventions::default();
        let ctx = ToolContext {
            document,
            undecided: &[],
            skills: &[],
            ui_language: "en",
            root: None,
            sees_images: false,
            conventions: &conventions,
            library: &[],
            memory: None,
            proposed: Default::default(),
            checks: Default::default(),
        };
        let call = |id: &str, name: &str, args: &str| AgentTurn::ToolCall {
            call_id: id.into(),
            name: name.into(),
            arguments: args.into(),
            reasoning: None,
        };
        let script = RefCell::new(VecDeque::from(vec![
            StepResult::ToolCalls(vec![call("r", "read_document", r#"{"heading":"Methods"}"#)]),
            StepResult::ToolCalls(vec![call(
                "bad",
                "propose_edit",
                r#"{"action":"replace","anchor":"We sampled 10 sites.","text":"x"}"#,
            )]),
            StepResult::ToolCalls(vec![call(
                "ok",
                "propose_edit",
                r#"{"action":"replace","anchor":"We sampled ten sites.","text":"We sampled ten coastal sites."}"#,
            )]),
            StepResult::Done("Named the site type.".into()),
        ]));
        let turns = tauri::async_runtime::block_on(run_agent_loop(
            vec![],
            AgentTurn::User {
                text: "Say which sites".into(),
                images: Vec::new(),
            },
            MAX_STEPS,
            |_| {
                let next = script.borrow_mut().pop_front().unwrap();
                async move { Ok(next) }
            },
            |call| tools.execute(&ctx, call),
            |name| tools.how_to_run(name),
            |_| {},
        ))
        .unwrap();

        let result = |id: &str| {
            turns
                .iter()
                .find_map(|t| match t {
                    AgentTurn::ToolResult {
                        call_id, output, ..
                    } if call_id == id => Some(output.clone()),
                    _ => None,
                })
                .unwrap()
        };
        assert!(result("r").contains("We sampled ten sites."));
        assert!(!result("r").contains("All good."));
        assert!(
            result("bad").starts_with("No exact match"),
            "{}",
            result("bad")
        );
        assert!(
            result("ok").starts_with("Edit proposed"),
            "{}",
            result("ok")
        );
    }

    #[test]
    fn history_keeps_no_tool_images_and_says_so() {
        let shown = AgentTurn::ToolResult {
            call_id: "v".into(),
            output: "Here is `map.png` (image/png).".into(),
            images: vec![ImageAttachment {
                name: "map.png".into(),
                mime: "image/png".into(),
                data_base64: "AAAA".into(),
            }],
        };
        let AgentTurn::ToolResult { output, images, .. } = for_history(shown) else {
            panic!("still a tool result");
        };
        assert!(images.is_empty());
        assert!(
            output.ends_with("call view_image again to look at it.]"),
            "{output}"
        );
        let plain = AgentTurn::ToolResult {
            call_id: "r".into(),
            output: "text".into(),
            images: Vec::new(),
        };
        assert!(
            matches!(for_history(plain), AgentTurn::ToolResult { output, .. } if output == "text")
        );
    }

    #[test]
    fn compact_history_stubs_old_reads_but_keeps_edit_results() {
        let big = "x".repeat(5_000);
        let history = vec![
            AgentTurn::User {
                text: "q".into(),
                images: Vec::new(),
            },
            AgentTurn::ToolCall {
                call_id: "r".into(),
                name: "read_file".into(),
                arguments: "{}".into(),
                reasoning: None,
            },
            AgentTurn::ToolResult {
                call_id: "r".into(),
                output: big.clone(),
                images: Vec::new(),
            },
            AgentTurn::ToolCall {
                call_id: "e".into(),
                name: "propose_edit".into(),
                arguments: "{}".into(),
                reasoning: None,
            },
            AgentTurn::ToolResult {
                call_id: "e".into(),
                output: big.clone(),
                images: Vec::new(),
            },
        ];
        let out = compact_history(history);
        let AgentTurn::ToolResult { output, .. } = &out[2] else {
            panic!()
        };
        assert!(output.len() < 1_000 && output.contains("omitted"));
        let AgentTurn::ToolResult { output, .. } = &out[4] else {
            panic!()
        };
        assert_eq!(output, &big);
    }

    #[test]
    fn compact_history_drops_whole_oldest_exchanges_over_budget() {
        let long = "y".repeat(HISTORY_BUDGET);
        let history = vec![
            AgentTurn::User {
                text: long.clone(),
                images: Vec::new(),
            },
            AgentTurn::assistant("a1"),
            AgentTurn::User {
                text: "recent".into(),
                images: Vec::new(),
            },
            AgentTurn::assistant("a2"),
        ];
        let out = compact_history(history);
        assert_eq!(out.len(), 2);
        assert!(matches!(&out[0], AgentTurn::User { text, .. } if text == "recent"));
    }

    /// One exchange of `chars` characters: a question, a file read, a reply.
    fn exchange(n: usize, chars: usize) -> Vec<AgentTurn> {
        vec![
            AgentTurn::User {
                text: format!("question {n}"),
                images: Vec::new(),
            },
            AgentTurn::ToolCall {
                call_id: format!("r{n}"),
                name: "read_file".into(),
                arguments: "{}".into(),
                reasoning: None,
            },
            AgentTurn::ToolResult {
                call_id: format!("r{n}"),
                output: "z".repeat(2_000),
                images: Vec::new(),
            },
            AgentTurn::assistant("a".repeat(chars)),
        ]
    }

    fn debug(turns: &[AgentTurn]) -> String {
        format!("{turns:?}")
    }

    /// What the prompt cache needs: a turn, once replayed, reads the same on
    /// every later send - the old read cut to the same stub each time.
    #[test]
    fn compacted_history_is_the_same_on_every_send() {
        let mut history = exchange(0, 100);
        let first = compact_history(history.clone());
        assert!(debug(&first).contains("omitted"));
        for n in 1..5 {
            history.extend(exchange(n, 100));
            let later = compact_history(history.clone());
            assert_eq!(debug(&later[..first.len()]), debug(&first));
        }
    }

    /// Over budget, the history's first message moves once per block of
    /// growth, not on every send - and between moves each send's history
    /// starts with the previous one's, so the cached prefix survives.
    #[test]
    fn over_budget_the_oldest_exchanges_go_in_blocks() {
        let mut history = Vec::new();
        let mut previous: Option<Vec<AgentTurn>> = None;
        let (mut sends, mut moves) = (0, 0);
        for n in 0..60 {
            history.extend(exchange(n, 9_000));
            let out = compact_history(history.clone());
            let kept: usize = out.iter().map(turn_chars).sum();
            assert!(kept <= HISTORY_BUDGET, "{kept} chars kept");
            if let Some(prev) = previous.filter(|_| n > 20) {
                sends += 1;
                if out.len() < prev.len() || debug(&out[..prev.len()]) != debug(&prev) {
                    moves += 1;
                    // A move drops a whole block and still keeps most of
                    // the budget.
                    assert!(kept >= HISTORY_BUDGET - HISTORY_DROP_STEP - 10_000);
                }
            }
            previous = Some(out);
        }
        // Each exchange is ~9.4k characters; a block is 50k.
        assert!(moves * 4 < sends, "{moves} moves in {sends} sends");
        assert!(moves > 0);
    }

    /// An attached file inlined into a message can make one exchange bigger
    /// than a block. Rounding the cut up to the next block end would then
    /// drop it with everything before it, though the budget only needs the
    /// oldest two exchanges gone - so it isn't rounded that far.
    #[test]
    fn over_budget_a_long_attachment_is_not_dropped_early() {
        let mut history = Vec::new();
        for n in 0..3 {
            history.extend(exchange(n, 10_000));
        }
        history.extend([
            AgentTurn::User {
                text: format!("<attached-file>{}</attached-file>", "p".repeat(130_000)),
                images: Vec::new(),
            },
            AgentTurn::assistant("summary"),
        ]);
        history.extend(exchange(5, 5_000));
        let out = compact_history(history);
        let kept: usize = out.iter().map(turn_chars).sum();
        assert!(kept <= HISTORY_BUDGET, "{kept} chars kept");
        assert!(matches!(&out[0], AgentTurn::User { text, .. } if text == "question 2"));
        assert!(debug(&out).contains("attached-file"));
    }

    /// A step's reasoning is replayed within its exchange only: the turn
    /// the frontend keeps, and sends back next time, has none.
    #[test]
    fn history_keeps_no_reasoning() {
        let call = AgentTurn::ToolCall {
            call_id: "c".into(),
            name: "read_document".into(),
            arguments: "{}".into(),
            reasoning: Some(serde_json::json!("thought")),
        };
        assert!(matches!(
            for_history(call),
            AgentTurn::ToolCall {
                reasoning: None,
                ..
            }
        ));
    }

    #[test]
    fn the_message_header_names_the_language_the_user_typed() {
        let cases = [
            ("What was the most common complaint?", Some("English")),
            ("把这段翻译成英文", Some("Simplified Chinese")),
            ("把這段翻譯成英文", Some("Traditional Chinese")),
            ("この段落を短くしてください", Some("Japanese")),
            // A selection, the cursor's surroundings and an expanded skill
            // are not what the user typed.
            (
                "<selected-text>\n图书馆每周日下午四点就闭馆了，很多读者抱怨。\n</selected-text>\n\nMake this more formal.",
                Some("English"),
            ),
            (
                "<skill name=\"tighten\" typed=\"/tighten\">\nTighten the passage. Keep every fact.\n</skill>\n\n帮我精简这一段",
                Some("Simplified Chinese"),
            ),
            ("ok", None),
        ];
        for (message, expected) in cases {
            assert_eq!(message_language(message), expected, "{message}");
        }
        let text = request_user_text("doc", "What was the most common complaint?");
        assert!(
            text.ends_with("---the user's message (written in English: reply in English, unless the user instructions set a reply language)---\nWhat was the most common complaint?"),
            "{text}"
        );
        assert!(request_user_text("doc", "ok").ends_with("---the user's message---\nok"));
    }

    #[test]
    fn short_document_is_embedded_verbatim() {
        let doc = "# Title\n\nJust a short document.";
        let section = document_section(doc, true, None);
        assert_eq!(section, format!("---document---\n{doc}"));
    }

    #[test]
    fn long_document_is_truncated_with_outline_and_excerpts() {
        let middle = "x".repeat(FULL_DOCUMENT_LIMIT + 1000);
        let doc = format!("# Start\n\nfirst-marker {middle} last-marker\n\n## End");
        let section = document_section(&doc, true, None);
        assert!(section.contains("truncated"));
        assert!(section.contains("# Start"));
        assert!(section.contains("## End"));
        assert!(section.contains("search_document"));
        assert!(section.contains("first-marker"));
        assert!(section.contains("last-marker"));
        // The bulk of the middle shouldn't appear - only outline + excerpts.
        assert!(section.len() < doc.len() / 2);
    }

    #[test]
    fn truncation_note_omits_tool_mention_without_tools() {
        let doc = "x".repeat(FULL_DOCUMENT_LIMIT + 1);
        let section = document_section(&doc, false, None);
        assert!(!section.contains("search_document"));
    }

    #[test]
    fn excerpts_are_char_boundary_safe_for_cjk() {
        // Every char here is multi-byte - a byte-index slice at a fixed
        // offset would panic mid-character.
        let doc = "中".repeat(FULL_DOCUMENT_LIMIT + 500);
        let section = document_section(&doc, true, None);
        assert!(section.contains('中'));
    }

    /// A Chinese document is about a token a character: past a third of the
    /// limit it is outlined, with the section being edited, where the
    /// model can read on - and sent whole where it can't.
    #[test]
    fn a_long_cjk_document_is_outlined_by_its_token_weight() {
        let mut doc = String::from("# 报告\n\n");
        for i in 0..20 {
            doc.push_str(&format!("## 第{i}节\n\n{}\n\n", "调研数据。".repeat(150)));
        }
        doc.push_str("## 目标\n\n用户正在改的段落。");
        let chars = doc.chars().count();
        assert!(chars > FULL_DOCUMENT_LIMIT / 3 && chars < FULL_DOCUMENT_LIMIT);
        let with_tools = document_section(&doc, true, Some("目标"));
        assert!(with_tools.contains("truncated"));
        assert!(with_tools.contains("用户正在改的段落。"));
        assert!(with_tools.chars().count() < chars / 2);
        assert_eq!(
            document_section(&doc, false, None),
            format!("---document---\n{doc}")
        );
        // The same length of English is still sent whole.
        let english = "x".repeat(chars);
        assert!(!document_section(&english, true, None).contains("truncated"));
    }

    #[test]
    fn a_long_document_still_carries_the_section_being_worked_on() {
        let mut doc = String::from("# Report\n\n");
        for i in 0..60 {
            doc.push_str(&format!(
                "## Part {i}\n\n{}\n\n",
                "filler text. ".repeat(80)
            ));
        }
        doc.push_str("## Target\n\nThe paragraph the user is editing.\n\n## After\n\nmore");
        let section = document_section(&doc, true, Some("Target"));
        assert!(section.contains("truncated"));
        assert!(section.contains("The paragraph the user is editing."));
        // The section ends where the next heading of its level starts.
        let (line, focus) = focus_section(&doc, "Target").unwrap();
        assert!(focus.starts_with("## Target"));
        assert!(!focus.contains("## After"));
        assert_eq!(doc.lines().nth(line - 1), Some("## Target"));
        assert!(!document_section(&doc, true, None).contains("the section the user is working in"));
    }

    #[test]
    fn style_and_mentioned_library_entries_reach_the_prompt() {
        let workspace = AgentWorkspace {
            style: Some("Short sentences. No adverbs.".into()),
            library: vec![
                crate::ai::project::parse_library_entry(
                    "a",
                    "a",
                    "---\nname: 林晚\naliases: [晚晚]\n---\n中学语文老师。",
                ),
                crate::ai::project::parse_library_entry(
                    "b",
                    "b",
                    "---\nname: 港城\n---\n海边城市。",
                ),
            ],
            ..AgentWorkspace::default()
        };
        let prompt = request_context(&workspace, "晚晚推开门。", true, "改写这句", None);
        assert!(prompt.contains("Short sentences. No adverbs."));
        assert!(
            prompt.contains("中学语文老师"),
            "mentioned via alias in the document"
        );
        assert!(!prompt.contains("海边城市"), "not mentioned anywhere");
    }

    #[test]
    fn a_built_in_skill_is_indexed_by_when_to_use_it() {
        assert_eq!(
            index_line("Fixes typos. Use when asked to proofread (校对, relire) or check (by hand) errors."),
            "Use when asked to proofread or check (by hand) errors."
        );
        assert_eq!(index_line("No trigger clause."), "No trigger clause.");
    }

    /// Without use_skill the guide stays in the prompt; with it, the prompt
    /// points at it and use_skill loads it.
    #[test]
    fn the_app_guide_is_loaded_on_demand_where_skills_can_be() {
        let plain = AgentWorkspace::default();
        assert!(workspace_section(&plain, "en").contains("What the app calls the things"));
        let with_skills = crate::ai::workspace::load_layers(None, None, None, &[]);
        assert!(with_skills.has_usable_skills());
        let section = workspace_section(&with_skills, "en");
        assert!(!section.contains("What the app calls the things"));
        assert!(section.contains("use_skill app-guide"));
        assert!(app_guide().contains("Learn my style"));
    }

    #[test]
    fn the_skill_index_offers_model_skills_and_prefers_the_users() {
        use crate::ai::workspace::{AgentSkill, SkillSource};
        let mut ws = crate::ai::workspace::load_layers(None, None, None, &["describe".to_string()]);
        ws.skills.push(AgentSkill {
            name: "house-headline".into(),
            description: "Titles in the house style".into(),
            prompt: "x".into(),
            source: SkillSource::Project,
            ..AgentSkill::default()
        });
        ws.skills.push(AgentSkill {
            name: "my-tone".into(),
            description: "d".repeat(700),
            prompt: "x".into(),
            source: SkillSource::Global,
            ..AgentSkill::default()
        });
        let index = skill_index(&ws, "en");
        let lines: Vec<&str> = index.lines().collect();
        assert!(lines[0].starts_with("- house-headline (project): "));
        assert!(lines[1].starts_with("- my-tone (yours): ") && lines[1].ends_with('…'));
        assert!(lines[1].chars().count() < 540, "a long description is cut");
        // A built-in says when to use it, without the request words in
        // eight languages; the user's own keep their description.
        assert_eq!(
            lines[2],
            "- continue-story: Use when asked to continue the story, write the next part or chapter, or what happens next. Not for non-fiction drafts or for questions about inline completion."
        );
        // In another UI a built-in carries that UI's name for it.
        let zh = skill_index(&ws, "zh");
        assert!(
            zh.contains("- continuity [/检查前后一致 in their UI]: "),
            "{zh}"
        );
        assert!(zh.contains("- house-headline (project): "));
        // /name-only skills and turned-off ones aren't offered.
        for absent in ["tighten", "expand", "change-tone", "summarize", "describe"] {
            assert!(!index.contains(&format!("- {absent}:")), "{absent}");
        }
        // Built-ins by menu category: write before revise before check
        // before format.
        let at = |name: &str| index.find(&format!("- {name}:")).unwrap();
        assert!(
            at("dialogue") < at("de-ai")
                && at("de-ai") < at("proofread")
                && at("proofread") < at("email")
        );
        // The system prompt carries it, the preference rule and the packs,
        // the same whatever the document.
        let a = build_instructions(&ws, "# One", true, AgentMode::Revise, "hi", "en");
        let b = build_instructions(
            &ws,
            "# Two\n\nOther text.",
            true,
            AgentMode::Revise,
            "other",
            "en",
        );
        assert_eq!(a, b);
        assert!(a.contains("When a skill marked (project) or (yours) and an unmarked built-in skill both match a request, use the marked one."));
        assert!(a.contains("standards-zh-hant") && !a.contains("contract,"));
        // Nothing to offer, no index.
        let mut none = ws.clone();
        none.skills.iter_mut().for_each(|s| s.enabled = false);
        assert!(
            !build_instructions(&none, "", true, AgentMode::Revise, "", "en")
                .contains("---available skills---")
        );
    }

    #[test]
    fn the_academic_skill_is_indexed_in_one_line() {
        let ws = crate::ai::workspace::load_layers(None, None, None, &[]);
        let zh = skill_index(&ws, "zh");
        let line = zh
            .lines()
            .find(|l| l.starts_with("- academic-polish [/学术润色 in their UI]: "))
            .unwrap_or_else(|| panic!("{zh}"));
        // Sent with every request: one line, under the 500 cap uncut, and
        // it names grant proposals so they route here.
        assert!(
            !line.ends_with('…') && line.contains("grant proposal"),
            "{line}"
        );
        assert!(!zh.contains("research-writing"));
    }

    #[test]
    fn the_workspace_section_says_which_folder_and_why() {
        use crate::ai::workspace::{load_from, RootSource};
        let doc_folder = load_from(None, Some("/tmp/novel/chapter-1.md"), None);
        assert_eq!(doc_folder.root_source, RootSource::DocumentFolder);
        let text = workspace_section(&doc_folder, "en");
        assert!(text.contains("/tmp/novel") && text.contains("own folder"));
        let tmp = std::env::temp_dir();
        let chosen = load_from(None, Some("/tmp/novel/chapter-1.md"), tmp.to_str());
        assert_eq!(chosen.root_source, RootSource::Chosen);
        assert!(workspace_section(&chosen, "en").contains("chosen by the user"));
        // An unsaved draft: no files, the reason, and the way out.
        let unsaved = load_from(None, None, None);
        assert_eq!(unsaved.root_source, RootSource::None);
        let text = workspace_section(&unsaved, "en");
        assert!(text.contains("isn't saved") && text.contains("Settings > Textus AI"));
        assert!(!text.contains("list_files"));
        // No project, no project bar: only the Settings row is offered.
        assert!(!text.contains("click the folder name"));
        assert!(workspace_section(&doc_folder, "en").contains("click the folder name"));
        assert!(workspace_section(&chosen, "en").contains("Use the document's folder"));
        let too_broad = AgentWorkspace {
            root_source: RootSource::TooBroad,
            ..AgentWorkspace::default()
        };
        let text = workspace_section(&too_broad, "en");
        assert!(text.contains("too broad") && !text.contains("click the folder name"));
        // The app's names, for every case: the English ones, and those of
        // the user's UI language - only that one.
        assert!(text.contains("Learn my style") && !text.contains("English |"));
        let chinese = workspace_section(&too_broad, "zh");
        assert!(chinese.contains("English | 中文\nproject folder | 项目文件夹\n"));
        assert!(chinese.contains("not \"style profile (文风档案)\", not \"资料库 (library)\""));
        assert!(!chinese.contains("日本語"));
        // A language whose names aren't translated yet gets the English
        // ones alone, and one the backend doesn't know of the same.
        assert_eq!(workspace_section(&too_broad, "xx"), text);
        // The tool-less fallback doesn't hear about file tools.
        let prompt = build_instructions(&unsaved, "draft", false, AgentMode::Revise, "", "en");
        assert!(!prompt.contains("---project---"));
        let review = request_preamble(&doc_folder, AgentMode::Review, "en");
        assert!(review.contains("Review mode:") && review.contains("Revise mode you"));
        let review = request_preamble(&doc_folder, AgentMode::Review, "ja");
        assert!(
            review.contains("Review mode (レビュー in their Japanese UI)")
                && review.contains("Revise mode (推敲)")
                && review.contains("Write mode (執筆)")
        );
    }

    #[test]
    fn the_prompt_names_things_exactly_as_the_ui_does() {
        // Every UI label the agent is told about must be the one the user
        // sees, in each language, or the agent sends people to menu items
        // that don't exist. Read from the frontend's files, so a language
        // still to be translated - no help guide of its own yet - is simply
        // not there.
        let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
        let read = |path: &str| std::fs::read_to_string(repo.join(path)).unwrap_or_default();
        let names_ts = read("src/i18n/names.ts");
        assert!(
            names_ts.contains(&format!("export const AI_NAME = \"{AI_NAME}\";")),
            "AI_NAME differs from src/i18n/names.ts"
        );
        assert!(
            names_ts.contains(&format!(
                "export const APP_NAME = \"{}\";",
                crate::app_identity::APP_NAME
            )),
            "APP_NAME differs from src/i18n/names.ts"
        );
        // The same languages as the UI offers, in the same order.
        let langs_ts = read("src/i18n/langs.ts");
        let list = langs_ts
            .split("export const LANGS = [")
            .nth(1)
            .and_then(|rest| rest.split("] as const").next())
            .expect("LANGS in src/i18n/langs.ts");
        let codes: Vec<&str> = list.split('"').skip(1).step_by(2).collect();
        assert_eq!(
            codes,
            UI_LANGUAGES.iter().map(|l| l.code).collect::<Vec<_>>()
        );

        // A chosen project folder: the case that names every label.
        let chosen = AgentWorkspace {
            root: Some("/tmp/novel".into()),
            root_source: crate::ai::workspace::RootSource::Chosen,
            ..AgentWorkspace::default()
        };
        let english: Vec<&str> = entries(UI_LANGUAGES[0].names).collect();
        for language in UI_LANGUAGES {
            let code = language.code;
            let strings = read(&format!("src/i18n/locales/{code}.ts"));
            let guide = read(&format!("src/help/agent-guide.{code}.md"));
            // A name is the UI's, or, for the few that are no label -
            // "project menu" - the help guide's. "Style (the chip)": the
            // label is what precedes the note.
            let known = |name: &str| {
                let name = name.split(" (").next().unwrap();
                strings.contains(name) || guide.to_lowercase().contains(&name.to_lowercase())
            };
            if code == "en" {
                for name in &english {
                    assert!(known(name), "neither the UI nor the guide says {name}");
                }
                continue;
            }
            let lines: Vec<&str> = entries(language.names).collect();
            if lines.is_empty() {
                continue;
            }
            let pairs: Vec<(&str, &str)> = lines
                .iter()
                .map(|line| {
                    line.split_once(" = ")
                        .unwrap_or_else(|| panic!("ui-names/{code}.txt: no \" = \" in {line}"))
                })
                .collect();
            assert_eq!(
                pairs.iter().map(|(en, _)| *en).collect::<Vec<_>>(),
                english,
                "ui-names/{code}.txt names every line of en.txt, in its order"
            );
            let prompt = build_instructions(&chosen, "draft", true, AgentMode::Review, "", code);
            assert!(prompt.contains(&format!("\nEnglish | {}\n", language.native)));
            for (en, name) in &pairs {
                assert!(
                    prompt.contains(&format!("{en} | {name}")),
                    "the prompt lacks {name}"
                );
                assert!(
                    known(name),
                    "{code}: neither the UI nor the guide says {name}"
                );
            }
        }

        // The labels the English description quotes, and those too short
        // to look up on their own, are exactly the strings' entries.
        let prompt = build_instructions(&chosen, "draft", true, AgentMode::Review, "", "en");
        let en_ts = read("src/i18n/locales/en.ts");
        for label in [
            "Choose project folder…",
            "Use the document's folder",
            "Learn my style from samples…",
            "Create style profile",
            "Open style profile",
            "New library entry…",
            "Edit project writing instructions",
            "Writing Instructions (agent.md)",
            "Edit agent.md",
            "Import Skill…",
        ] {
            assert!(prompt.contains(label), "the prompt lacks {label}");
            assert!(
                en_ts.contains(&format!("\"{label}\"")),
                "the UI has no {label}"
            );
        }
        let (zh_ts, ja_ts) = (
            read("src/i18n/locales/zh.ts"),
            read("src/i18n/locales/ja.ts"),
        );
        for (strings, entry) in [
            (&en_ts, "projectStyleChip: \"Style\""),
            (&zh_ts, "projectStyleChip: \"文风\""),
            (&ja_ts, "projectStyleChip: \"文体\""),
            (&en_ts, "agentWorkspaceRootLabel: \"Project Folder\""),
            (&zh_ts, "agentWorkspaceRootLabel: \"项目文件夹\""),
            (
                &ja_ts,
                "agentWorkspaceRootLabel: \"プロジェクトフォルダー\"",
            ),
            (&zh_ts, "agentSkillsLabel: \"技能\""),
            (&ja_ts, "agentSkillsLabel: \"スキル\""),
            (&zh_ts, "settingsTitle: \"设置\""),
            (&ja_ts, "settingsTitle: \"設定\""),
            (&zh_ts, "tutorialContinuationTitle: \"续写\""),
            (&ja_ts, "completionToneLabel: \"補完のトーン\""),
            (&zh_ts, "proposalAccept: \"采纳\""),
            (&ja_ts, "proposalAccept: \"適用\""),
            (&zh_ts, "proposalReject: \"拒绝\""),
            (&ja_ts, "proposalReject: \"却下\""),
        ] {
            assert!(strings.contains(entry), "the UI has no {entry}");
        }
        assert!(prompt.contains(&format!("Settings > {AI_NAME} > Project Folder")));
        // The backend's own pointer to Settings names the same page.
        assert!(crate::ai::route::NOT_CONFIGURED.contains(&format!("Settings > {AI_NAME}.")));
    }

    #[test]
    fn interaction_mode_is_explicit_in_every_message() {
        let workspace = AgentWorkspace::default();
        let message =
            |mode| request_message(&workspace, mode, "en", "---document---\ndraft", "Go.");
        let review = message(AgentMode::Review);
        assert!(review.contains("interaction mode: review"));
        assert!(
            build_instructions(&workspace, "draft", true, AgentMode::Review, "", "en")
                .contains("no document edit tool is available")
        );

        assert!(message(AgentMode::Revise).contains("interaction mode: revise"));

        // Write adds after a selection rather than replacing it, and sends
        // a request to change what is there to Revise.
        let write = message(AgentMode::Write);
        assert!(write.contains("interaction mode: write"));
        assert!(
            write.contains("right after the selection") && write.contains("never in place of it")
        );
        assert!(write.contains("say it needs Revise mode"));
        // The mode comes before the document and the user's words.
        assert!(write.find("interaction mode").unwrap() < write.find("---document---").unwrap());
        // Tool-less, it stays in the system prompt with everything else.
        assert!(
            build_instructions(&workspace, "draft", false, AgentMode::Write, "", "en")
                .contains("interaction mode: write")
        );
    }

    /// Switching between Write and Revise, or saving a memory, must not
    /// change the system prompt or the tool list: either rewrote the whole
    /// cached prefix and the history after it (docs/design/ai-tokens.md).
    #[test]
    fn the_cached_prefix_survives_a_mode_switch_and_a_new_memory() {
        use crate::ai::memory::{Memories, Memory, MemoryKind, Scope};
        let mut ws = AgentWorkspace {
            remember: true,
            ..AgentWorkspace::default()
        };
        let prefix = |ws: &AgentWorkspace, mode| {
            let tools = ToolRegistry::builtin(false, false, mode, true, false);
            let specs: Vec<String> = tools
                .specs()
                .iter()
                .map(|s| format!("{}{}{}", s.name, s.description, s.parameters))
                .collect();
            (build_instructions(ws, "draft", true, mode, "", "en"), specs)
        };
        let revise = prefix(&ws, AgentMode::Revise);
        assert_eq!(prefix(&ws, AgentMode::Write), revise);
        ws.memories = Memories {
            items: vec![Memory {
                id: "personal/memory/x".into(),
                scope: Scope::Personal,
                kind: MemoryKind::Preference,
                text: "Reply briefly.".into(),
                file: String::new(),
                remembered: Default::default(),
                included: true,
            }],
            ..Default::default()
        };
        assert_eq!(prefix(&ws, AgentMode::Revise), revise);
        assert!(request_message(&ws, AgentMode::Revise, "en", "", "Go.").contains("Reply briefly."));
    }

    #[test]
    fn project_writing_instructions_follow_and_override_the_global_ones() {
        let global = "Always reply in English.";
        let project = "Reply in Chinese.";
        let both = AgentWorkspace {
            instructions: vec![global.into()],
            project_instructions: Some(project.into()),
            ..AgentWorkspace::default()
        };
        let prompt = build_instructions(&both, "draft", true, AgentMode::Revise, "", "en");
        let global_at = prompt.find(global).unwrap();
        let project_at = prompt.find(project).unwrap();
        assert!(global_at < project_at, "global first, project after");
        assert!(prompt.contains(
            "---user instructions for this project (where they conflict with the ones above, follow these)---\nReply in Chinese."
        ));

        // One layer alone keeps the plain header, whichever layer it is.
        for alone in [
            AgentWorkspace {
                instructions: vec![global.into()],
                ..AgentWorkspace::default()
            },
            AgentWorkspace {
                project_instructions: Some(global.into()),
                ..AgentWorkspace::default()
            },
        ] {
            let prompt = build_instructions(&alone, "draft", true, AgentMode::Revise, "", "en");
            assert!(prompt.contains("---user instructions---\nAlways reply in English."));
            assert!(!prompt.contains("---user instructions for this project"));
        }
    }

    #[test]
    fn remembered_memories_follow_the_users_instructions() {
        use crate::ai::memory::{Memories, Memory, MemoryKind, Scope};
        let memory = |scope, text: &str| Memory {
            id: String::new(),
            scope,
            kind: MemoryKind::Preference,
            text: text.into(),
            file: String::new(),
            remembered: Default::default(),
            included: true,
        };
        let ws = AgentWorkspace {
            instructions: vec!["Global rule.".into()],
            memories: Memories {
                items: vec![
                    memory(Scope::Personal, "Reply briefly."),
                    memory(Scope::Project, "Spell it colour."),
                ],
                ..Default::default()
            },
            remember: true,
            ..AgentWorkspace::default()
        };
        let prompt = build_instructions(&ws, "draft", true, AgentMode::Review, "", "en");
        assert!(prompt.contains("---remembering---"), "every mode");
        // What is remembered comes with the message, after the user's own
        // instructions (in the system prompt).
        let message = request_message(&ws, AgentMode::Review, "en", "", "Go.");
        let personal = message.find("Reply briefly.").unwrap();
        let project = message.find("Spell it colour.").unwrap();
        assert!(prompt.contains("Global rule.") && personal < project);
        // Without tools there is no remember tool to talk about.
        let flat = build_instructions(&ws, "draft", false, AgentMode::Review, "", "en");
        assert!(flat.contains("Reply briefly.") && !flat.contains("---remembering---"));
    }

    #[test]
    fn a_selected_picture_in_the_documents_folder_is_seen() {
        let dir = std::env::temp_dir().join(format!("textus-selpic-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("assets")).unwrap();
        // A 1x1 PNG.
        let png = base64::Engine::decode(
            &base64::engine::general_purpose::STANDARD,
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
        )
        .unwrap();
        std::fs::write(dir.join("assets/boats.png"), png).unwrap();
        let doc = dir.join("harbour.md");
        let doc = doc.to_str();
        let ask = |selection: &str| {
            selected_picture(
                &format!("<selected-text>\n{selection}\n</selected-text>\n\nWhat is in it?"),
                doc,
            )
        };
        let seen = ask("![Boats](assets/boats.png)").expect("the picture");
        assert_eq!(seen.mime, "image/png");
        assert!(ask("![Boats](<assets/boats.png> \"Boats\")").is_some());
        // More than the picture, a picture on the web, or outside the folder.
        assert!(ask("Look: ![Boats](assets/boats.png)").is_none());
        assert!(ask("![Boats](https://example.com/boats.png)").is_none());
        assert!(ask("![Boats](../boats.png)").is_none());
        assert!(selected_picture("What is in it?", doc).is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
