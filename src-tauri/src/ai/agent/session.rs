//! What every request opens before it runs - a chat message and each of
//! Research's commands alike: the provider from the catalog, its model
//! from route::agent_provider, its own web search, the user's workspace
//! and guidance, and the pictures' run.

use crate::ai::catalog::ProviderCatalogEntry;
use crate::ai::images::{ImageModel, ImageRun};
use crate::ai::workspace::AgentWorkspace;
use aicompat::capabilities::{NativeSearch, ThinkingLevel};
use aicompat::providers::AgentProvider;

/// The provider and the project a request names.
pub(crate) struct Session<'a> {
    pub app: &'a tauri::AppHandle,
    pub entry: &'static ProviderCatalogEntry,
    pub model: Option<String>,
    pub doc_path: Option<&'a str>,
    pub workspace_root: Option<&'a str>,
}

impl<'a> Session<'a> {
    /// Refused while Textus AI is off, or for a provider the catalog
    /// doesn't have.
    pub(crate) fn open(
        app: &'a tauri::AppHandle,
        provider: &str,
        model: Option<String>,
        doc_path: Option<&'a str>,
        workspace_root: Option<&'a str>,
    ) -> Result<Self, String> {
        crate::ai::ensure_on(app)?;
        let entry = crate::ai::catalog::find(provider)
            .ok_or_else(|| format!("unknown provider: {provider}"))?;
        Ok(Self {
            app,
            entry,
            model,
            doc_path,
            workspace_root,
        })
    }

    /// The model's own web search, if it has one.
    pub(crate) fn native_search(&self) -> Option<NativeSearch> {
        crate::ai::web::native_search_for(self.entry.id, self.model.as_deref())
    }

    /// The model a request steps, thinking as hard as `thinking` and
    /// searching the web by itself with `native`; None for one that can't
    /// call tools, which the chat answers in one plain completion.
    pub(crate) async fn provider(
        &self,
        thinking: ThinkingLevel,
        native: Option<NativeSearch>,
    ) -> Result<Option<AgentProvider>, String> {
        crate::ai::route::agent_provider(self.app, self.entry, self.model.clone(), thinking, native)
            .await
    }

    /// The model Research's stages step: `provider`, refused for one that
    /// can't call tools, which every stage hands its work over with.
    pub(crate) async fn agent(
        &self,
        native: Option<NativeSearch>,
    ) -> Result<AgentProvider, String> {
        self.provider(Default::default(), native)
            .await?
            .ok_or_else(|| {
                format!(
                    "{} can't call tools, which writing a paper needs.",
                    self.entry.label
                )
            })
    }

    /// The user's workspace: their instructions, memories, skills and
    /// style, and the project's.
    pub(crate) fn workspace(&self) -> AgentWorkspace {
        crate::ai::workspace::load(self.app, self.doc_path, self.workspace_root)
    }

    /// What the user asks of all the writing done for them - their
    /// instructions, memories, style and library - for a piece on `topic`.
    pub(crate) fn guidance(&self, topic: &str) -> String {
        super::writing_guidance(&mut self.workspace(), topic)
    }

    /// The pictures' run with `model`, made beside the document; None
    /// without one.
    pub(crate) fn pictures(&self, model: Option<&ImageModel>) -> Option<ImageRun> {
        ImageRun::resolve(self.app, model, self.entry.id).map(|run| run.in_folder(self.doc_path))
    }
}
