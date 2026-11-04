//! What every paper command opens before its stages run, from the parts
//! the chat's requests use: the provider from the catalog, its model from
//! route::agent_provider - one that calls tools, which every stage hands
//! its work over with - its own web search, the folder the paper is kept
//! in, and the user's guidance from the workspace.

use super::paper_root;
use crate::ai::catalog::ProviderCatalogEntry;
use crate::ai::images::{ImageModel, ImageRun};
use aicompat::capabilities::NativeSearch;
use aicompat::providers::AgentProvider;
use std::path::PathBuf;

/// The provider and the project a paper command names.
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

    /// The folder paper `id` is kept in; None for a new id.
    pub(crate) fn root(&self, id: Option<&str>) -> Result<PathBuf, String> {
        paper_root(self.app, self.doc_path, self.workspace_root, id)
    }

    /// The model's own web search, if it has one.
    pub(crate) fn native_search(&self) -> Option<NativeSearch> {
        crate::ai::web::native_search_for(self.entry.id, self.model.as_deref())
    }

    /// The model the stages step, searching the web by itself with
    /// `native`. Refused for one that can't call tools.
    pub(crate) async fn agent(
        &self,
        native: Option<NativeSearch>,
    ) -> Result<AgentProvider, String> {
        crate::ai::route::agent_provider(
            self.app,
            self.entry,
            self.model.clone(),
            Default::default(),
            native,
        )
        .await?
        .ok_or_else(|| {
            format!(
                "{} can't call tools, which writing a paper needs.",
                self.entry.label
            )
        })
    }

    /// What the user asks of all the writing done for them - their
    /// instructions, memories, style and library - for a piece on `topic`.
    pub(crate) fn guidance(&self, topic: &str) -> String {
        let mut workspace =
            crate::ai::workspace::load(self.app, self.doc_path, self.workspace_root);
        crate::ai::agent::writing_guidance(&mut workspace, topic)
    }

    /// The pictures' run with `model`, made beside the document; None
    /// without one.
    pub(crate) fn pictures(&self, model: Option<&ImageModel>) -> Option<ImageRun> {
        ImageRun::resolve(self.app, model, self.entry.id).map(|run| run.in_folder(self.doc_path))
    }
}
