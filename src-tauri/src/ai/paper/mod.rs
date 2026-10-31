//! The long-form paper agent: a topic researched, outlined, approved by the
//! user, then drafted section by section (docs/design/ai-paper.md). This
//! module holds what the stages share - the paper, its research dossier and
//! outline, the research budget - and how they are kept on disk. Its shapes
//! are generated into src/platform/bindings/ai-paper.ts (`npm run bindings`).

// The stages that use the store, the budget and most events arrive in later
// branches.
#![allow(dead_code, unused_imports)]

mod budget;
mod draft;
mod events;
mod outline;
mod research;
mod store;

pub(crate) use budget::{BudgetCounts, BudgetKind, ResearchBudget, SharedBudget};
pub(crate) use events::{PaperEvent, PaperPhase, SectionStatus};
pub(crate) use store::{load, load_section, new_id, save, save_section, PaperFiles};

use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;

/// One paper being written. Kept as `.textus/papers/<id>/paper.json`.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct Paper {
    pub id: String,
    pub topic: String,
    /// The language it is written in, a BCP 47 tag ("zh", "en").
    pub language: String,
    /// How long the finished text should be, in characters.
    pub target_chars: u32,
    /// What its research may still spend; kept so a resumed paper can't
    /// start over with a full budget.
    pub budget: ResearchBudget,
}

/// What the research helpers found. Kept as `dossier.json`.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct Dossier {
    pub notes: Vec<Note>,
    /// The sources the notes cite, numbered once for the whole paper: what
    /// `Note::sources` and the text's `[n]` point at, and the reference list.
    #[serde(default)]
    pub sources: Vec<aicompat::agent::Source>,
}

/// One finding: a claim and what supports it.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct Note {
    /// "n1", "n2", ...: what an outline section's `evidence` names.
    pub id: String,
    /// The research question it answers.
    pub question: String,
    pub claim: String,
    pub evidence: String,
    /// Words taken verbatim from a source, if any.
    pub quote: Option<String>,
    /// The sources' numbers in the paper's source book.
    pub sources: Vec<u32>,
    pub leads: Vec<Lead>,
}

/// A picture or a data set a note's source has that a figure could use.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct Lead {
    pub kind: LeadKind,
    pub description: String,
    pub url: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub enum LeadKind {
    Image,
    Data,
}

/// The plan the user approves before drafting. Kept as `outline.json`.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct Outline {
    pub thesis: String,
    pub sections: Vec<OutlineSection>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct OutlineSection {
    pub title: String,
    pub key_points: Vec<String>,
    /// The dossier notes it draws on, by id.
    pub evidence: Vec<String>,
    pub target_words: u32,
    pub figures: Vec<FigurePlan>,
}

/// A figure the section will have, and how it is made.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct FigurePlan {
    pub kind: FigureKind,
    /// What to draw: a picture prompt, the diagram or chart to make from
    /// which notes, or the picture to look for.
    pub spec: String,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub enum FigureKind {
    /// A picture made by the image service (`textus-picture:`).
    Generated,
    Mermaid,
    /// A ```chart block from the dossier's data.
    Chart,
    /// A picture found on the web, with its source and licence.
    Web,
}

/// Writes a paper on `topic` in the document's project: for now its
/// research - the questions planned, the helpers' notes - kept in
/// `.textus/papers/<id>/`. The outline and drafting follow in later
/// branches. Stopped like any request, by `ai_cancel` with `request_id`.
/// What starting a paper takes. Mirrored in src/platform/bindings/ai-paper.ts.
#[derive(Deserialize, Debug)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct PaperRequest {
    pub provider: String,
    pub model: Option<String>,
    pub doc_path: Option<String>,
    pub workspace_root: Option<String>,
    /// What web_search uses when the model can't search by itself.
    pub search_service: Option<String>,
    pub searxng_url: Option<String>,
    pub request_id: String,
    pub topic: String,
    /// The language it is written in, a BCP 47 tag.
    pub language: String,
    pub target_chars: u32,
}

#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn ai_paper_run(
    app: tauri::AppHandle,
    request: PaperRequest,
    channel: Channel<PaperEvent>,
) -> Result<Paper, String> {
    crate::ai::ensure_on(&app)?;
    let PaperRequest {
        provider,
        model,
        doc_path,
        workspace_root,
        search_service,
        searxng_url,
        request_id,
        topic,
        language,
        target_chars,
    } = request;
    let root = crate::ai::workspace::project_root(doc_path.as_deref(), workspace_root.as_deref())
        .ok_or_else(|| "NO_PROJECT".to_string())?;
    let entry = crate::ai::catalog::find(&provider)
        .ok_or_else(|| format!("unknown provider: {provider}"))?;
    let budget = std::sync::Arc::new(SharedBudget::new(ResearchBudget::for_paper()));
    let native = crate::ai::web::native_search(
        &provider,
        model
            .as_deref()
            .or(entry.agent_default_model)
            .unwrap_or_default(),
    );
    let service =
        crate::ai::web::resolve_service(&app, search_service.as_deref(), searxng_url.as_deref());
    let web = crate::ai::web::WebPlan::new(true, native, service, &[]).with_budget(budget.clone());
    let send = |event: PaperEvent| {
        let _ = channel.send(event);
    };
    crate::ai::cancel::cancellable(request_id, async {
        let agent =
            crate::ai::route::agent_provider(&app, entry, model, Default::default(), native)
                .await?
                .ok_or_else(|| {
                    format!(
                        "{} can't call tools, which writing a paper needs.",
                        entry.label
                    )
                })?;
        let mut paper = Paper {
            id: new_id(),
            topic,
            language,
            target_chars,
            budget: budget.snapshot(),
        };
        let dossier = research::research(&agent, &paper, &web, &budget, &send).await?;
        paper.budget = budget.snapshot();
        // Kept before the outline, so a failed outline doesn't cost the
        // research.
        let mut files = PaperFiles {
            paper: paper.clone(),
            dossier,
            outline: None,
        };
        save(&root, &files)?;
        send(PaperEvent::Phase {
            phase: PaperPhase::Outlining,
        });
        let outline = outline::make_outline(&agent, &paper, &files.dossier).await?;
        files.outline = Some(outline.clone());
        save(&root, &files)?;
        send(PaperEvent::OutlineReady { outline });
        send(PaperEvent::Phase {
            phase: PaperPhase::AwaitingOutline,
        });
        Ok(paper)
    })
    .await
}

/// What drafting an outlined paper takes. Mirrored in
/// src/platform/bindings/ai-paper.ts.
#[derive(Deserialize, Debug)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct DraftRequest {
    pub provider: String,
    pub model: Option<String>,
    pub doc_path: Option<String>,
    pub workspace_root: Option<String>,
    pub request_id: String,
    /// The paper, outlined and its outline approved.
    pub id: String,
}

/// Drafts paper `id` from its saved outline: every section written, kept
/// beside the paper and sent as `sectionDrafted`, in order. Stopped like any
/// request, by `ai_cancel` with `request_id`.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn ai_paper_draft(
    app: tauri::AppHandle,
    request: DraftRequest,
    channel: Channel<PaperEvent>,
) -> Result<(), String> {
    crate::ai::ensure_on(&app)?;
    let root = crate::ai::workspace::project_root(
        request.doc_path.as_deref(),
        request.workspace_root.as_deref(),
    )
    .ok_or_else(|| "NO_PROJECT".to_string())?;
    let files = load(&root, &request.id)?;
    let outline = files
        .outline
        .clone()
        .ok_or_else(|| "This paper has no outline yet.".to_string())?;
    let entry = crate::ai::catalog::find(&request.provider)
        .ok_or_else(|| format!("unknown provider: {}", request.provider))?;
    let send = |event: PaperEvent| {
        let _ = channel.send(event);
    };
    crate::ai::cancel::cancellable(request.request_id.clone(), async {
        let agent = crate::ai::route::agent_provider(
            &app,
            entry,
            request.model.clone(),
            Default::default(),
            None,
        )
        .await?
        .ok_or_else(|| {
            format!(
                "{} can't call tools, which writing a paper needs.",
                entry.label
            )
        })?;
        send(PaperEvent::Phase {
            phase: PaperPhase::Drafting,
        });
        let started = |i: usize| {
            send(PaperEvent::Section {
                index: i as u32,
                status: SectionStatus::Drafting,
            })
        };
        let mut drafted = |i: usize, markdown: &str| {
            save_section(&root, &files.paper.id, i, markdown)?;
            send(PaperEvent::SectionDrafted {
                index: i as u32,
                markdown: markdown.to_string(),
            });
            Ok(())
        };
        draft::draft(
            &agent,
            &files.paper,
            &outline,
            &files.dossier,
            &started,
            &mut drafted,
        )
        .await
    })
    .await
}

/// The outline as the user edited it on the card, kept for drafting. Notes
/// it names that the dossier doesn't have are dropped; it needs a section,
/// and every section a title.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn ai_paper_save_outline(
    doc_path: Option<String>,
    workspace_root: Option<String>,
    id: String,
    outline: Outline,
) -> Result<Outline, String> {
    let root = crate::ai::workspace::project_root(doc_path.as_deref(), workspace_root.as_deref())
        .ok_or_else(|| "NO_PROJECT".to_string())?;
    let mut files = load(&root, &id)?;
    let outline = outline::as_edited(outline, &files.dossier)?;
    files.outline = Some(outline.clone());
    save(&root, &files)?;
    Ok(outline)
}

#[cfg(test)]
mod tests;
