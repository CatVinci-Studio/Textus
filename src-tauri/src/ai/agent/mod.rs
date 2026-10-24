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

/// Skill loads, file reads, and web searches all consume steps, so a
/// research-y request needs more headroom than the old chat-only loop did.
pub(crate) const MAX_STEPS: usize = 12;

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
    // The document, block by block as the editor has it (doc_blocks.rs).
    blocks: Vec<doc_blocks::SentBlock>,
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
            on_event,
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
    image_model: Option<crate::ai::images::ImageModel>,
    on_event: Channel<StreamEvent>,
) -> Result<Vec<AgentTurn>, String> {
    let mut workspace = workspace::load(&app, doc_path.as_deref(), workspace_root.as_deref());
    let conventions = crate::ai::conventions::for_workspace(&app, &workspace);
    let library = crate::ai::conventions::library_names(&workspace);
    // What the request is about, for picking library entries and, past the
    // budget, memories: the message as the user's side sent it, before the
    // reference packs go in.
    let focus = message.clone();
    workspace.memories.select_for(&focus);
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
    let image_run = crate::ai::images::ImageRun::resolve(&app, image_model.as_ref(), entry.id)
        .map(|run| run.in_folder(doc_path.as_deref()));

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
            // A change through the whole of a long document, chapter by
            // chapter at once (chapters.rs): each chapter's helper has
            // propose_edit, and its turns join this request's.
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
                channel: &on_event,
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
            // A document shown whole needs no tools to read it: offered,
            // they were read again and again instead of edited (DeepSeek,
            // 1.2.0-rc.6).
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
                    &on_event,
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
            // Pictures written into the text, begun as their lines stream in.
            let inline = image_run.as_ref().map(|run| run.inline(&tool_ctx.proposed));
            let tool_specs = tools.specs();
            let step = |turns: Vec<AgentTurn>| {
                let (agent, instructions, tool_specs) = (&agent, &instructions, &tool_specs);
                let channel = on_event.clone();
                let inline = inline.as_ref();
                let (document, conventions) = (&document, &conventions);
                async move {
                    // Edits and comments as lists to the model, one call
                    // per item past it (lists.rs).
                    let lists = lists::ListStream::default();
                    let sink = |e: ProviderEvent<'_>| {
                        lists.feed(e, &|e| forward(&channel, web, inline, e))
                    };
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
                "{output}\n[The image was shown for that request only - call read_file again to look at it.]"
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
/// file is in the document's folder: PNG, JPEG, GIF or WebP, as read_file
/// reads them. None for a picture on the web, one outside the folder, or
/// a selection of anything more.
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
