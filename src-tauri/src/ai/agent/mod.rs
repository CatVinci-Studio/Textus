use crate::ai::cancel;
use crate::ai::catalog;
use crate::ai::doc_blocks::{self, Document};
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
use std::path::Path;
use tauri::ipc::Channel;
use tauri::AppHandle;

mod events;
pub(crate) use events::*;
mod settle;
pub(crate) use settle::*;

mod chapters;
mod context;
mod history;
pub(crate) mod lists;
mod past;
mod prompt;
pub(crate) use chapters::*;
pub(crate) use context::*;
pub(crate) use history::*;
pub(crate) use past::*;
pub(crate) use prompt::*;

/// The system prompt with what it says about the web, when search is on.
fn with_web_section(instructions: String, web: &WebPlan) -> String {
    match web.prompt_section() {
        Some(section) => format!("{instructions}\n\n{section}"),
        None => instructions,
    }
}

/// Skill loads, file reads, and web searches all consume steps.
pub(crate) const MAX_STEPS: usize = 12;

/// Sends one user message and returns the new turns for the frontend's
/// history, racing the request against its cancel signal (`ai::cancel`).
// Each parameter is a distinct invoke() payload key.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn ai_agent_message(
    app: AppHandle,
    provider: String,
    // The document, block by block as the editor has it.
    blocks: Vec<doc_blocks::SentBlock>,
    doc_path: Option<String>,
    // The chosen project folder. None keeps the document's own folder.
    workspace_root: Option<String>,
    history: Vec<AgentTurn>,
    message: String,
    // Attachments with no text to extract; text-shaped ones were already
    // inlined into `message` by the frontend.
    images: Vec<ImageAttachment>,
    web_search: bool,
    // How hard the model thinks. None (an older frontend) is Auto.
    thinking: Option<ThinkingLevel>,
    // "auto" (None from an older frontend) or a service id, and the SearXNG
    // address: what web_search uses when the model has no search of its own.
    search_service: Option<String>,
    searxng_url: Option<String>,
    mode: AgentMode,
    model: Option<String>,
    request_id: String,
    // Heading of the section the user is working in.
    focus_heading: Option<String>,
    // The UI language, for the names the agent is told the app uses.
    // None (an older frontend) is English.
    ui_language: Option<String>,
    // The image model; None for none, and from an older frontend.
    image_model: Option<crate::ai::images::ImageModel>,
    on_event: Channel<StreamEvent>,
) -> Result<Vec<AgentTurn>, String> {
    crate::ai::ensure_on(&app)?;
    let web_service = web_search
        .then(|| web::resolve_service(&app, search_service.as_deref(), searxng_url.as_deref()))
        .flatten();
    let ui_language = ui_language.unwrap_or_else(|| "en".to_string());
    cancel::cancellable(
        request_id,
        ai_agent_message_inner(
            app,
            provider,
            Document::from_blocks(blocks),
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
            image_model,
            &on_event,
        ),
    )
    .await
}

#[allow(clippy::too_many_arguments)]
async fn ai_agent_message_inner(
    app: AppHandle,
    provider: String,
    document: Document,
    doc_path: Option<String>,
    // The chosen project folder. None keeps the document's own folder.
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
    image_model: Option<crate::ai::images::ImageModel>,
    on_event: &dyn EventSink,
) -> Result<Vec<AgentTurn>, String> {
    let mut workspace = workspace::load(&app, doc_path.as_deref(), workspace_root.as_deref());
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
    // Refuse rather than drop: the model would answer confidently about a
    // picture it never saw. The frontend hides attach for these providers.
    if !images.is_empty() && !entry.supports_vision {
        return Err(format!(
            "{} can't read images. Remove the image, or switch provider in Settings > {AI_NAME}.",
            entry.label
        ));
    }
    // Tool-calling paths: the document rides in this message. The tool-less
    // fallback rebuilds its own turn.
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
    let image_run = crate::ai::images::ImageRun::resolve(&app, image_model.as_ref(), entry.id)
        .map(|run| run.in_folder(doc_path.as_deref()));

    let agent = route::agent_provider(&app, entry, model.clone(), thinking, web.native).await?;
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
                workspace.root.is_some(),
                mode,
                entry.supports_vision,
            );
            if helper_tools.edits() && offers_chapters(&document) {
                let run = &chapter_run;
                tools.add(tools::Tool {
                    spec: chapters_spec(),
                    access: tools::Access::Proposes,
                    modes: tools::EDITING_MODES,
                    run: tools::Run::Async(Box::new(move |call| Box::pin(run.run(call)))),
                });
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
            // The tools of the MCP servers the user turned on.
            #[cfg(desktop)]
            for tool in crate::mcp::tools_for_request(&app).await {
                tools.add(tool);
            }
            // And of the plugins the user gave ai.tools.
            for tool in crate::plugins::ai_tools::tools_for_request(&app) {
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
                    let result = agent.step(instructions, &turns, tool_specs, &sink).await;
                    // Native search citations numbered (WebPlan::finish_step).
                    result.map(|(step, _)| {
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
                result => result.map(|turns| with_helper_turns(turns, &helpers)),
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

/// A turn as the frontend keeps it: a tool result without the images it
/// showed the model, which would grow the saved history by megabytes.
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
                "{output}\n[The image was shown for that request only - call read_file again to look at it.]"
            ),
            images: Vec::new(),
        },
        turn => turn,
    }
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
