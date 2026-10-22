use crate::ai::agent::AgentMode;
use crate::ai::builtin;
use crate::ai::workspace::{AgentSkill, Invocation};
use aicompat::agent::{ToolCall, ToolOutput, ToolRun, ToolSpec};
use serde_json::json;
use std::future::Future;
use std::path::Path;
use std::pin::Pin;

mod conventions;
mod document;
mod edits;
mod folder;
use conventions::*;
pub(crate) use document::*;
pub(crate) use edits::*;
pub(crate) use folder::ADD_COMMENT_TOOL_NAME;
use folder::*;

mod ledger;
pub(crate) use ledger::*;
mod offered;
pub(crate) use offered::*;
mod budget;
pub(crate) use budget::*;

/// Everything a tool implementation needs to actually do its work. Grows as
/// more tools need more context (e.g. an MCP client handle) without changing
/// each tool's call signature.
pub struct ToolContext<'a> {
    /// Proposals from earlier requests the user hasn't accepted or
    /// rejected (images::undecided_edits): their text is part of the
    /// document as the user sees it, in place of what a rewrite replaces,
    /// so an edit may change it - the frontend puts that edit into the
    /// proposal (usePendingEdits's joinEdit).
    pub undecided: &'a [crate::ai::images::UndecidedEdit],
    pub document: &'a str,
    /// The merged skills: built-in, global config folder, project .textus/.
    pub skills: &'a [AgentSkill],
    /// The UI language (src/i18n/langs.ts) - which language's writing
    /// conventions a skill gets when the document is too short to tell.
    pub ui_language: &'a str,
    /// The project folder (workspace root) - the sandbox boundary for the
    /// file tools. The document's own folder by default, or the chosen
    /// project folder (see workspace::resolve_root). None for an unsaved
    /// draft with no folder chosen, or a folder too broad to use, in which
    /// case the file tools aren't offered at all.
    pub root: Option<&'a Path>,
    /// The provider takes images (catalog's `supports_vision`, the gate on
    /// the chat's image attachments): the file tools then list images and
    /// read_file shows them.
    pub sees_images: bool,
    /// The writing conventions (setting and style-profile front matter)
    /// check_conventions checks against.
    pub conventions: &'a crate::ai::rules::Conventions,
    /// Library names and aliases, for the library-name rule.
    pub library: &'a [String],
    /// The passages this request's proposals already replace or delete
    /// (their `context`, else their anchor; "" for the selection). One
    /// context serves one request, every step of it.
    pub proposed: std::sync::Mutex<ProposalLedger>,
    /// How often this request has called each check tool (CHECK_BUDGETS).
    pub checks: std::sync::Mutex<std::collections::HashMap<&'static str, usize>>,
}

/// A tool the agent can call: what the model is told (name, description,
/// JSON schema), what calling it does, the modes it is offered in, and its
/// implementation. Built-in tools (like `search_document` below) run here;
/// the web tools and generate_image are added per request
/// ([`ToolRegistry::add`]), and a plugin's or an MCP server's tools will be
/// too - a spec from the plugin or server, and an [`Run::Async`] that
/// forwards the call.
pub struct Tool<'a> {
    pub spec: ToolSpec,
    pub access: Access,
    pub modes: &'static [AgentMode],
    pub run: Run<'a>,
}

/// What calling a tool does, which decides how its calls run
/// ([`ToolRegistry::how_to_run`]).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Access {
    /// Only reads (the document, the project, the web): a step's reads run
    /// together.
    ReadOnly,
    /// Proposes a change the user reviews, or changes something of
    /// Textus AI's own (a memory): one call at a time, in call order.
    Proposes,
    /// Proposes, and records what it made in its own call (generate_image's
    /// picture), which is where the frontend reads the proposal from.
    ProposesInItsCall,
}

/// The modes a tool is offered in.
pub const EVERY_MODE: &[AgentMode] = &[AgentMode::Review, AgentMode::Revise, AgentMode::Write];
/// Write and Revise: the modes that change the document.
pub const EDITING_MODES: &[AgentMode] = &[AgentMode::Revise, AgentMode::Write];

pub type ToolFuture<'a> = Pin<Box<dyn Future<Output = ToolOutput> + Send + 'a>>;

/// A tool's implementation, by what it answers with.
pub enum Run<'a> {
    Text(fn(&ToolContext, &str) -> String),
    /// Text and images for the model to look at (read_file).
    Seeing(fn(&ToolContext, &str) -> ToolOutput),
    /// Awaited, with what it needs captured: a search, a page read, a
    /// picture being made - work that waits on the network, which Stop
    /// drops in flight.
    Async(Box<dyn Fn(ToolCall) -> ToolFuture<'a> + Send + Sync + 'a>),
}

/// The tools one request offers, assembled for its mode: the built-ins
/// that have something to work on ([`builtin_tools`]), then what the
/// request adds - the web tools, generate_image, and later plugin and MCP
/// tools. The one place a tool is looked up by name.
pub struct ToolRegistry<'a> {
    mode: AgentMode,
    tools: Vec<Tool<'a>>,
}

impl<'a> ToolRegistry<'a> {
    /// No tools yet: what `mode` offers is added to it.
    pub fn new(mode: AgentMode) -> Self {
        Self {
            mode,
            tools: Vec::new(),
        }
    }

    /// The built-in tools for `mode` (see [`builtin_tools`] for the rest).
    pub fn builtin(has_skills: bool, has_root: bool, mode: AgentMode, sees_images: bool) -> Self {
        let mut registry = Self::new(mode);
        registry.tools = builtin_tools(has_skills, has_root, mode, sees_images);
        registry
    }

    /// Takes the tool named `name` out, if it is offered.
    pub fn remove(&mut self, name: &str) {
        self.tools.retain(|t| t.spec.name != name);
    }

    /// Adds `tool` if this request's mode offers it.
    pub fn add(&mut self, tool: Tool<'a>) {
        if tool.modes.contains(&self.mode) {
            self.tools.push(tool);
        }
    }

    pub fn specs(&self) -> Vec<ToolSpec> {
        self.tools.iter().map(|t| t.spec.clone()).collect()
    }

    /// Whether this request may change the document: its mode has
    /// propose_edit.
    pub fn edits(&self) -> bool {
        self.find(PROPOSE_EDIT_TOOL_NAME).is_some()
    }

    fn find(&self, name: &str) -> Option<&Tool<'a>> {
        self.tools.iter().find(|t| t.spec.name == name)
    }

    /// How the agent loop runs `name`'s calls (aicompat's ToolRun). A name
    /// the model made up runs on its own, and is told it doesn't exist.
    pub fn how_to_run(&self, name: &str) -> ToolRun {
        match self.find(name).map(|t| t.access) {
            Some(Access::ReadOnly) => ToolRun::Concurrent,
            Some(Access::ProposesInItsCall) => ToolRun::Amending,
            Some(Access::Proposes) | None => ToolRun::InOrder,
        }
    }

    pub async fn execute(&self, ctx: &ToolContext<'_>, call: ToolCall) -> ToolOutput {
        if let Some(refusal) = spend_check(ctx, &call.name, &call.arguments) {
            return refusal.into();
        }
        match self.find(&call.name).map(|t| &t.run) {
            Some(Run::Text(run)) => {
                let mut text = run(ctx, &call.arguments);
                let ledger = ctx.proposed.lock().unwrap_or_else(|e| e.into_inner());
                let edited = !self.edits() || ledger.proposed_any();
                // A run rewritten in parts whose next part may not have
                // come (agent::settle::open_run).
                let next = match &ledger.open_run {
                    Some((id, next))
                        if *id == call.call_id
                            && call.name == PROPOSE_EDIT_TOOL_NAME
                            && text.starts_with(EDIT_PROPOSED) =>
                    {
                        Some(next.clone())
                    }
                    _ => None,
                };
                drop(ledger);
                let open = next.is_some();
                if let Some(next) = next {
                    text.push_str(&run_goes_on(&next));
                }
                ToolOutput {
                    settled: !open && settles(&call.name, &text, edited),
                    text,
                    ..ToolOutput::default()
                }
            }
            Some(Run::Seeing(run)) => run(ctx, &call.arguments),
            Some(Run::Async(run)) => run(call).await,
            None => format!("Unknown tool: {}", call.name).into(),
        }
    }
}

#[cfg(test)]
mod tests;
