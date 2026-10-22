use crate::ai::cancel;
use crate::ai::catalog;
use crate::ai::doc_blocks::{self, Block};
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

mod context;
mod history;
mod prompt;
pub(crate) use context::*;
pub(crate) use history::*;
pub(crate) use prompt::*;

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
    // An edit naming its block (doc_blocks.rs) becomes one quoting it first,
    // so everything after - the tool, the history, the frontend - sees
    // anchors as before.
    let blocks = doc_blocks::split(document);
    let calls = calls
        .into_iter()
        .map(|call| match call {
            AgentTurn::ToolCall {
                call_id,
                name,
                arguments,
                reasoning,
            } if name == tools::PROPOSE_EDIT_TOOL_NAME => {
                let arguments = doc_blocks::resolve_edit_arguments(document, &blocks, &arguments);
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
            // A comment or a picture names its block too.
            AgentTurn::ToolCall {
                call_id,
                name,
                arguments,
                reasoning,
            } if name == tools::ADD_COMMENT_TOOL_NAME
                || name == crate::ai::images::GENERATE_IMAGE_TOOL_NAME =>
            {
                AgentTurn::ToolCall {
                    arguments: doc_blocks::resolve_target_arguments(document, &blocks, &arguments),
                    call_id,
                    name,
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
                memory: memory.as_ref(),
                // The pictures not decided yet: this request's text may
                // carry them, each once.
                proposed: std::sync::Mutex::new(tools::ProposalLedger::with_pictures(
                    crate::ai::images::undecided_pictures(&history),
                )),
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
mod tests;
