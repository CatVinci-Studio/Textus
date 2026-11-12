use crate::ai::cancel;
use crate::ai::doc_blocks::{self, Document};
use crate::ai::images::InlinePictures;
use crate::ai::rules::Conventions;
use crate::ai::tools::{self, ToolContext, ToolRegistry};
use crate::ai::ui_language::UiNames;
use crate::ai::web::{self, WebPlan};
use crate::ai::workspace::AgentWorkspace;
use aicompat::agent::{
    run_agent_loop, AgentTurn, ImageAttachment, LoopEvent, ProviderEvent, StepResult,
};
use aicompat::capabilities::ThinkingLevel;
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::ipc::Channel;
use tauri::AppHandle;

mod events;
pub(crate) use events::*;
mod settle;
pub(crate) use settle::*;

mod chapters;
mod context;
pub(crate) mod history;
pub(crate) mod lists;
mod model;
mod past;
mod prompt;
mod session;
pub(crate) use chapters::*;
pub(crate) use context::*;
pub(crate) use history::*;
pub(crate) use model::*;
pub(crate) use past::*;
pub(crate) use prompt::*;
pub use session::AgentRequest;
pub(crate) use session::Session;

/// The system prompt with what it says about the web, when search is on.
fn with_web_section(instructions: String, web: &WebPlan) -> String {
    match web.prompt_section() {
        Some(section) => format!("{instructions}\n\n{section}"),
        None => instructions,
    }
}

/// Skill loads, file reads, and web searches all consume steps.
pub(crate) const MAX_STEPS: usize = 12;

/// One user message for the agent, as the frontend sends it.
#[derive(Deserialize)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct MessageRequest {
    provider: String,
    /// The document, block by block as the editor has it.
    blocks: Vec<doc_blocks::SentBlock>,
    doc_path: Option<String>,
    /// The chosen project folder, or None.
    workspace_root: Option<String>,
    /// The conversation, whose scratch folder holds its attached files.
    conversation: Option<String>,
    history: Vec<AgentTurn>,
    message: String,
    /// Attachments with no text to extract; text-shaped ones were already
    /// inlined into `message` by the frontend.
    images: Vec<ImageAttachment>,
    web_search: bool,
    /// How hard the model thinks. None is Auto.
    thinking: Option<ThinkingLevel>,
    /// "auto" (None) or a service id, and the SearXNG address: what
    /// web_search uses when the model has no search of its own.
    search_service: Option<String>,
    searxng_url: Option<String>,
    mode: AgentMode,
    model: Option<String>,
    request_id: String,
    /// Heading of the section the user is working in.
    focus_heading: Option<String>,
    /// The UI language, for the names the agent is told the app uses. None
    /// is English.
    ui_language: Option<String>,
    /// The image model; None for none.
    image_model: Option<crate::ai::images::ImageModel>,
    /// General mode's file changes wait to be applied. None writes them.
    ask_before_file_changes: Option<bool>,
}

/// Sends one user message and returns the new turns for the frontend's
/// history, racing the request against its cancel signal (`ai::cancel`).
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn ai_agent_message(
    app: AppHandle,
    window: tauri::Window,
    request: MessageRequest,
    on_event: Channel<StreamEvent>,
) -> Result<Vec<AgentTurn>, String> {
    let MessageRequest {
        provider,
        blocks,
        doc_path,
        workspace_root,
        conversation,
        history,
        message,
        images,
        web_search,
        thinking,
        search_service,
        searxng_url,
        mode,
        model,
        request_id,
        focus_heading,
        ui_language,
        image_model,
        ask_before_file_changes,
    } = request;
    // What every request names, as Research's requests carry it too.
    let request = AgentRequest {
        provider,
        model,
        doc_path,
        workspace_root,
        conversation,
        search_service,
        searxng_url,
        request_id,
        image_model,
        // Revisions unless told otherwise: the app's own default.
        ask_before_file_changes: ask_before_file_changes.unwrap_or(true),
    };
    let web_service = web_search.then(|| request.search_service(&app)).flatten();
    let ui_language = ui_language.unwrap_or_else(|| "en".to_string());
    cancel::cancellable(
        request.request_id.clone(),
        ai_agent_message_inner(
            app,
            window.label().to_string(),
            &request,
            Document::from_blocks(blocks),
            history,
            message,
            images,
            web_search,
            web_service,
            thinking.unwrap_or_default(),
            mode,
            focus_heading,
            ui_language,
            &on_event,
        ),
    )
    .await
}

#[allow(clippy::too_many_arguments)]
async fn ai_agent_message_inner(
    app: AppHandle,
    // The window that asked: only its plugins' tools are offered.
    window: String,
    request: &AgentRequest,
    document: Document,
    history: Vec<AgentTurn>,
    message: String,
    images: Vec<ImageAttachment>,
    web_search: bool,
    web_service: Option<web::search::Service>,
    thinking: ThinkingLevel,
    mode: AgentMode,
    focus_heading: Option<String>,
    ui_language: String,
    on_event: &dyn EventSink,
) -> Result<Vec<AgentTurn>, String> {
    let session = request.session(&app)?;
    let (entry, model, doc_path) = (session.entry, session.model.as_deref(), session.doc_path);
    let mut workspace = session.workspace();
    let scratch = crate::ai::scratch::with_attachments(request.conversation.as_deref());
    workspace.attached = scratch.is_some();
    let conventions = crate::ai::conventions::for_workspace(&app, &workspace);
    let library = crate::ai::conventions::library_names(&workspace);
    // What the request is about, for picking library entries and, past the
    // budget, memories: the message as the user's side sent it, before the
    // reference packs go in.
    let focus = message.clone();
    workspace.memories.select_for(&focus);
    // A /name call gets the skill's instructions and reference packs filled in
    // here, and history keeps the expanded message.
    let message = crate::ai::builtin::expand_message_with(
        &message,
        &workspace.skills,
        &document,
        &ui_language,
        crate::ai::builtin::chosen_profile(&conventions, &document).as_deref(),
    );
    // Numbered on from the sources earlier replies cited - so from the
    // history as it came, before it is cut down for sending.
    let web_plan = WebPlan::new(web_search, session.native_search(), web_service, &history);
    let web = &web_plan;
    let history = compact_history(web::with_sources_in_text(history));

    // A selected picture is shown to a model that can see, not only its
    // Markdown: "what's in this picture", "redo it brighter".
    let mut images = images;
    if entry.supports_vision {
        images.extend(selected_picture(&focus, doc_path));
    }
    // Refuse rather than drop: the model would answer confidently about a
    // picture it never saw. The frontend hides attach for these providers.
    if !images.is_empty() && !entry.supports_vision {
        return Err(format!(
            "{} can't read images. Remove the image, or switch provider in Settings > {AI_NAME}.",
            entry.label
        ));
    }
    // Tool-calling paths: the document rides in this message. The tool-less
    // fallback rebuilds its own turn. Create can't read the document, so it
    // isn't told to.
    let reads_document =
        ToolRegistry::builtin(false, false, mode, false).offers(tools::READ_DOCUMENT_TOOL_NAME);
    let (context, sent_library) = request_context_and_library(
        &workspace,
        &document,
        reads_document,
        &focus,
        focus_heading.as_deref(),
    );
    crate::ai::project::record_library_use(doc_path, &sent_library);
    let text = request_message(&workspace, mode, &ui_language, &context, &message);
    // Written straight in: said before all else in the request.
    let text = if request.ask_before_file_changes || mode != AgentMode::Write {
        text
    } else {
        format!("{}\n\n{text}", prompt::CHANGES_WRITTEN_IN)
    };
    let user_turn = AgentTurn::User { text, images };
    let plain_message = message.clone();
    // generate_image, while an image model is set.
    let image_run = session.pictures(request);

    let agent = session.provider(thinking, web.native).await?;
    let result = match agent {
        Some(agent) => {
            let instructions = with_web_section(
                build_instructions(&workspace, &document, true, mode, &focus, &ui_language),
                web,
            );
            // The text of proposals still undecided from earlier requests: an edit or
            // a picture may go into it.
            let undecided = crate::ai::images::undecided_edits(&history);
            let tool_ctx = ToolContext {
                document: &document,
                undecided: &undecided,
                skills: &workspace.skills,
                ui_language: &ui_language,
                root: workspace.root.as_deref().map(Path::new),
                scratch: scratch.as_deref(),
                sees_images: entry.supports_vision,
                conventions: &conventions,
                library: &library,
                // The pictures not decided yet: this request's text may
                // carry them, each once.
                proposed: std::sync::Mutex::new(tools::ProposalLedger::with_pictures(
                    crate::ai::images::undecided_pictures(&history),
                )),
                checks: Default::default(),
            };
            let stores = tauri::Manager::state::<crate::settings::Stores>(&app);
            // A change through the whole of a long document, chapter by chapter at
            // once: each chapter's helper has propose_edit, and its turns join ours.
            let helper_tools = ToolRegistry::builtin(false, false, mode, entry.supports_vision)
                .only(tools::PROPOSE_EDIT_TOOL_NAME);
            let helpers = HelperTurns::default();
            crate::ai::kept_proposals::know_app_data(&app);
            let file_edits = crate::ai::file_changes::FileEdits::new(
                workspace.root.as_deref().map(Path::new),
                request.conversation.as_deref(),
                doc_path.map(Path::new),
                request.ask_before_file_changes,
            );
            let chapter_run = ChapterRun {
                agent: &agent,
                workspace: &workspace,
                document: &document,
                mode,
                ui_language: &ui_language,
                conventions: &conventions,
                tools: &helper_tools,
                tool_ctx: &tool_ctx,
                channel: on_event,
                helpers: &helpers,
            };
            let mut tools = ToolRegistry::builtin(
                workspace.has_usable_skills(),
                workspace.root.is_some() || scratch.is_some(),
                mode,
                entry.supports_vision,
            );
            // The folder's other files, in General mode.
            if let Some(edits) = &file_edits {
                tools.extend(edits.tools());
            }
            if helper_tools.edits() && offers_chapters(&document) {
                let run = &chapter_run;
                tools.add(tools::Tool {
                    spec: chapters_spec(),
                    access: tools::Access::Proposes,
                    modes: tools::EDITING_MODES,
                    run: tools::Run::Async(Box::new(move |call| Box::pin(run.run(call)))),
                });
            }
            // The reference library's search, once there is a library.
            if let Some(tool) = tools::references_tool(workspace.root.as_deref().map(Path::new)) {
                tools.add(tool);
            }
            // A document shown whole needs no tools to read it: offered, they were
            // read again and again instead of edited.
            if context::shown_whole(&document, true) {
                tools.remove(tools::SEARCH_TOOL_NAME);
                tools.remove(tools::READ_DOCUMENT_TOOL_NAME);
            }
            if let Some(image_run) = &image_run {
                tools.add(image_run.tool(
                    &document,
                    crate::ai::images::ProposedText {
                        this_request: &tool_ctx.proposed,
                        undecided: &undecided,
                    },
                    on_event,
                ));
            }
            for tool in web.tools(&focus) {
                tools.add(tool);
            }
            // The user's earlier conversations, when they refer to one.
            tools.add(search_conversations_tool(&stores.chat));
            for tool in installed_tools(&app, &window).await {
                tools.add(tool);
            }
            // Create mode reads the plugins installed, to change one.
            if let Some(tool) = crate::plugins::read_tool::read_plugin_tool(&app) {
                tools.add(tool);
            }
            // Pictures written into the text, begun as their lines stream in.
            let inline = image_run.as_ref().map(|run| run.inline(&tool_ctx.proposed));
            let tool_specs = tools.specs();
            let step = |turns: Vec<AgentTurn>| {
                let (agent, instructions, tool_specs) = (&agent, &instructions, &tool_specs);
                let channel = on_event;
                let inline = inline.as_ref();
                let (document, conventions) = (&document, &conventions);
                async move {
                    // Edits and comments as lists to the model, one call per item past it.
                    let lists = lists::ListStream::default();
                    let sink =
                        |e: ProviderEvent<'_>| lists.feed(e, &|e| forward(channel, web, inline, e));
                    let turns = lists::join_calls(&turns);
                    let result = agent
                        .step_watched(instructions, &turns, tool_specs, &sink)
                        .await;
                    // Native search citations numbered (WebPlan::finish_step).
                    result.map(|step| {
                        settle_step(web.finish_step(step), document, conventions, inline).0
                    })
                }
            };
            // `history` is cloned so the plain-chat fallback below still has
            // it; `run_agent_loop` would otherwise have consumed it.
            match run_agent_loop(
                history.clone(),
                user_turn,
                MAX_STEPS,
                step,
                |call| tools.execute(&tool_ctx, call),
                |name| tools.how_to_run(name),
                report(on_event),
            )
            .await
            {
                // A server that doesn't implement `tools` properly gets a single
                // tool-less completion instead of failing the request. Only
                // that: a rate limit, a key refused or a timeout is said as it
                // is, not hidden behind a second request.
                Err(e) if agent.falls_back_to_plain_chat() && refuses_tools(&e) => {
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
                        &request.provider,
                        &instructions,
                        history,
                        message,
                        Some(&agent.model),
                    )
                    .await
                }
                result => result.map(|turns| with_helper_turns(turns, &helpers)),
            }
        }
        None => {
            let instructions =
                build_instructions(&workspace, &document, false, mode, &focus, &ui_language);
            flattened_chat_turn(
                &app,
                &request.provider,
                &instructions,
                history,
                message,
                model,
            )
            .await
        }
    };
    // History keeps the message as the user wrote it: replaying the document
    // copy in every later request would multiply the prompt.
    result.map(|turns| {
        let mut turns: Vec<AgentTurn> = turns.into_iter().map(for_history).collect();
        if let Some(AgentTurn::User { text, .. }) = turns.first_mut() {
            *text = plain_message;
        }
        web.attach_sources(&mut turns);
        turns
    })
}

/// The tools of the MCP servers the user turned on, and of the asking
/// window's plugins the user gave ai.tools: what every mode and Research's
/// researchers offer.
pub(crate) async fn installed_tools<'a>(app: &AppHandle, window: &str) -> Vec<tools::Tool<'a>> {
    let mut installed = Vec::new();
    #[cfg(desktop)]
    installed.extend(crate::mcp::tools_for_request(app).await);
    installed.extend(crate::plugins::ai_tools::tools_for_request(app, window));
    installed
}

/// Providers without tool calling get the conversation flattened into one
/// plain-text turn and a single completion.
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
            // Images are dropped on purpose: the command already refused an
            // image-carrying message for these providers.
            AgentTurn::User { text, .. } => Some(format!("User: {text}")),
            AgentTurn::Assistant { text, .. } => Some(format!("Assistant: {text}")),
            _ => None,
        }
    }

    let user_turn = AgentTurn::user(message);
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

/// The picture a message's selection is, when it is one picture and nothing
/// else, in the document's folder, and PNG, JPEG, GIF or WebP.
fn selected_picture(message: &str, doc_path: Option<&str>) -> Option<ImageAttachment> {
    let inner = message
        .strip_prefix("<selected-text>")?
        .split_once("</selected-text>")?
        .0
        .trim();
    if !inner.starts_with("![") {
        return None;
    }
    crate::ai::images::local_picture(inner, Path::new(doc_path?).parent()?)
}

#[cfg(test)]
mod tests;

/// Whether a request's error says the server can't take tools (it names
/// them in refusing the request), rather than any other failure.
fn refuses_tools(error: &str) -> bool {
    let lower = error.to_ascii_lowercase();
    ["tool", "function call", "function_call", "functions"]
        .iter()
        .any(|word| lower.contains(word))
        && !lower.contains("403")
        && !matches!(
            crate::ai::error_kind::kind(error),
            Some("rateLimit" | "timeout" | "auth" | "balance")
        )
}
