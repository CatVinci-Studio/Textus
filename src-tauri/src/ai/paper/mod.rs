//! The long-form paper agent: a topic researched, outlined, approved by the
//! user, then drafted section by section (docs/design/ai-paper.md). This
//! module holds what the stages share - the paper, its research dossier and
//! outline, the research budget - and how they are kept on disk. Its shapes
//! are generated into src/platform/bindings/ai-paper.ts (`npm run bindings`).

mod budget;
mod checks;
mod draft;
mod events;
mod finish;
mod library;
mod model;
mod outline;
mod research;
mod review;
mod store;
mod timeline;
mod web_figures;

use budget::KeepSpent;
pub(crate) use budget::{BudgetCounts, ResearchBudget, SharedBudget};
pub(crate) use events::{ActivityKind, PaperEvent, PaperPhase, SectionStatus, SourceEntry};
pub(crate) use store::{
    clear_sections, load, load_section, new_id, save, save_section, PaperFiles,
};

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
    /// How far it has come, so a paper stopped - or the app quit - goes on
    /// from there.
    #[serde(default)]
    pub stage: PaperStage,
}

/// How far a paper has come.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub enum PaperStage {
    /// Begun: its research, if any, is not kept until it is whole.
    #[default]
    Researching,
    /// Researched and outlined; waiting for the outline to be approved.
    Outlined,
    /// Its outline approved: being drafted, its sections kept as written.
    Drafting,
    /// Drafted, reviewed and revised: only finishing is left, so going on
    /// doesn't review and revise it again.
    Reviewed,
    /// Written into its document.
    Done,
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
    /// The paper to go on with, or the id a new one is kept under; None
    /// for a new id.
    pub id: Option<String>,
    pub topic: String,
    /// The language it is written in, a BCP 47 tag.
    pub language: String,
    pub target_chars: u32,
    /// The image model, for the pictures the outline may plan; None for
    /// none.
    pub image_model: Option<crate::ai::images::ImageModel>,
}

/// Researches and outlines a paper on `topic` in the document's project,
/// kept in `.textus/papers/<id>/`; a paper begun before goes on from what
/// it kept. Stopped like any request, by `ai_cancel` with `request_id`.
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
        id,
        topic,
        language,
        target_chars,
        image_model,
    } = request;
    let root = crate::ai::workspace::project_root(doc_path.as_deref(), workspace_root.as_deref())
        .ok_or_else(|| "NO_PROJECT".to_string())?;
    let entry = crate::ai::catalog::find(&provider)
        .ok_or_else(|| format!("unknown provider: {provider}"))?;
    // A paper begun before goes on from what it kept: its research, its
    // outline, what its research may still spend.
    let kept = id.as_deref().and_then(|id| load(&root, id).ok());
    // As many pictures as one send may make, the paper's own limit aside:
    // the outline plans no more than can be drawn.
    let mut research_budget = kept
        .as_ref()
        .map_or_else(ResearchBudget::for_paper, |f| f.paper.budget.renewed());
    let images = research_budget.limits.images;
    research_budget.limits.images =
        crate::ai::images::ImageRun::resolve(&app, image_model.as_ref(), &provider)
            .map_or(0, |run| research_budget.limits.images.min(run.limit as u32));
    let budget = std::sync::Arc::new(SharedBudget::new(research_budget));
    let native = crate::ai::web::native_search(
        &provider,
        model
            .as_deref()
            .or(entry.agent_default_model)
            .unwrap_or_default(),
    );
    let service =
        crate::ai::web::resolve_service(&app, search_service.as_deref(), searxng_url.as_deref());
    let can_search = native.is_some() || service.is_some();
    let web = crate::ai::web::WebPlan::new(true, native, service, &[]).with_budget(budget.clone());
    let send = |event: PaperEvent| {
        let _ = channel.send(event);
    };
    send(PaperEvent::WebSearch {
        available: can_search,
    });
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
        let agent = model::Metered {
            inner: &agent,
            budget: &budget,
        };
        let mut files = kept.unwrap_or_else(|| PaperFiles {
            paper: Paper {
                id: id.unwrap_or_else(new_id),
                topic,
                language,
                target_chars,
                budget: budget.snapshot(),
                stage: PaperStage::Researching,
            },
            dossier: Dossier::default(),
            outline: None,
        });
        // Kept at once, so a paper stopped while researching is found and
        // begun again.
        save(&root, &files)?;
        let mut keep_spent = KeepSpent {
            root: &root,
            id: files.paper.id.clone(),
            budget: budget.clone(),
            images,
            done: false,
        };
        if files.dossier.notes.is_empty() {
            let library = root
                .join(crate::ai::project::REFERENCES_DIR)
                .is_dir()
                .then_some(root.as_path());
            let dossier =
                research::research(&agent, &files.paper, &web, &budget, &send, library).await?;
            // Questions cut short would leave it thin: going on researches again.
            if agent.spent() {
                return Err(budget::STEPS_SPENT.to_string());
            }
            files.dossier = dossier;
            files.paper.budget = keep_spent.spent();
            // Kept before the outline, so a failed outline doesn't cost the
            // research.
            save(&root, &files)?;
        }
        let outline = match files.outline.clone() {
            Some(outline) => outline,
            None => {
                send(PaperEvent::Phase {
                    phase: PaperPhase::Outlining,
                });
                outline::make_outline(&agent, &files.paper, &files.dossier, &send).await?
            }
        };
        files.outline = Some(outline.clone());
        if files.paper.stage == PaperStage::Researching {
            files.paper.stage = PaperStage::Outlined;
        }
        files.paper.budget = keep_spent.spent();
        save(&root, &files)?;
        keep_spent.done = true;
        send(PaperEvent::OutlineReady { outline });
        send(PaperEvent::Phase {
            phase: PaperPhase::AwaitingOutline,
        });
        Ok(files.paper)
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
    /// The image model the paper's pictures are made with; None for none.
    pub image_model: Option<crate::ai::images::ImageModel>,
}

/// Drafts paper `id` from its saved outline: every section written and kept
/// beside the paper, the whole reviewed and the sections it faults revised
/// once, then each sent as `sectionDrafted`, in order - nothing is proposed
/// before the review, so no proposal is replaced after it. Stopped like any
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
        let budget = std::sync::Arc::new(SharedBudget::new(files.paper.budget.renewed()));
        let mut keep_spent = KeepSpent {
            root: &root,
            id: files.paper.id.clone(),
            budget: budget.clone(),
            images: files.paper.budget.limits.images,
            done: false,
        };
        let agent = model::Metered {
            inner: &agent,
            budget: &budget,
        };
        send(PaperEvent::Sources {
            heading: finish::references_heading(&files.paper.language).into(),
            sources: files
                .dossier
                .sources
                .iter()
                .map(|s| SourceEntry {
                    n: s.n,
                    entry: finish::entry(s),
                })
                .collect(),
        });
        send(PaperEvent::Phase {
            phase: PaperPhase::Drafting,
        });
        let started = |i: usize| {
            send(PaperEvent::Section {
                index: i as u32,
                status: SectionStatus::Drafting,
            })
        };
        // What an earlier run of this draft wrote stays written.
        let written = (0..outline.sections.len())
            .map(|i| load_section(&root, &files.paper.id, i))
            .collect::<Result<Vec<_>, _>>()?;
        let mut sections: Vec<String> = Vec::with_capacity(outline.sections.len());
        let mut drafted = |i: usize, markdown: &str| {
            save_section(&root, &files.paper.id, i, markdown)?;
            sections.push(markdown.to_string());
            // The stream's last words may have been held back.
            send(PaperEvent::SectionText {
                index: i as u32,
                text: markdown.to_string(),
            });
            send(PaperEvent::Section {
                index: i as u32,
                status: SectionStatus::Drafted,
            });
            Ok(())
        };
        draft::draft(
            &agent,
            &files.paper,
            &outline,
            &files.dossier,
            &written,
            &started,
            &mut drafted,
            &send,
        )
        .await?;

        // Reviewed before a stop: its kept sections are the revised ones.
        if files.paper.stage != PaperStage::Reviewed {
            send(PaperEvent::Phase {
                phase: PaperPhase::Reviewing,
            });
            // A review that fails costs the paper nothing: its sections
            // passed their own checks.
            let issues = review::review(&agent, &files.paper, &outline, &sections)
                .await
                .unwrap_or_default();
            let revising = |i: usize| {
                send(PaperEvent::Section {
                    index: i as u32,
                    status: SectionStatus::Revising,
                })
            };
            let changed = review::revise(
                &agent,
                &files.paper,
                &outline,
                &files.dossier,
                &mut sections,
                &issues,
                &revising,
                &send,
            )
            .await;
            for i in changed {
                save_section(&root, &files.paper.id, i, &sections[i])?;
                send(PaperEvent::SectionText {
                    index: i as u32,
                    text: sections[i].clone(),
                });
            }
            if agent.spent() {
                return Err(budget::STEPS_SPENT.to_string());
            }
            let mut reviewed = files.clone();
            reviewed.paper.stage = PaperStage::Reviewed;
            save(&root, &reviewed)?;
        }
        send(PaperEvent::Phase {
            phase: PaperPhase::Finishing,
        });
        let language = &files.paper.language;
        // Web pictures first: one Commons has nothing for becomes a picture
        // to generate, begun with the planned ones.
        for section in &mut sections {
            *section = web_figures::resolve(section, web_figures::find_on_commons).await;
        }
        // Pictures begun before the figures are numbered, so one that can't
        // be made leaves no caption behind.
        let pictures =
            crate::ai::images::ImageRun::resolve(&app, request.image_model.as_ref(), entry.id)
                .map(|run| run.in_folder(request.doc_path.as_deref()));
        for section in &mut sections {
            *section = match &pictures {
                Some(run) => crate::ai::images::place_pictures(run, section).0,
                None => finish::without_pictures(section),
            };
        }
        finish::number_figures(&mut sections, language);
        // Numbered first, so only the sources cited are looked up.
        let mut dossier = finish::number_citations(&mut sections, &files.dossier);
        finish::title_sources(&mut dossier).await;
        let references = finish::references(&sections, &dossier, language);
        let sections: Vec<String> = sections
            .iter()
            .map(|s| finish::plain_citations(s))
            .collect();
        let opening = finish::opening(&agent, &files.paper, &outline, &sections).await;
        send(PaperEvent::Ready {
            markdown: finish::assemble(&opening, &sections, references.as_deref()),
        });
        let mut files = files;
        files.paper.stage = PaperStage::Done;
        files.paper.budget = keep_spent.spent();
        save(&root, &files)?;
        keep_spent.done = true;
        send(PaperEvent::Phase {
            phase: PaperPhase::Done,
        });
        Ok(())
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
    files.paper.stage = PaperStage::Drafting;
    // Sections drafted from an outline before this one aren't this one's.
    clear_sections(&root, &id)?;
    save(&root, &files)?;
    Ok(outline)
}

/// How far a kept paper has come: what its card offers to go on with.
#[derive(Serialize, Debug)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct PaperProgress {
    pub paper: Paper,
    pub outline: Option<Outline>,
    /// How many of the outline's sections are written.
    pub drafted: u32,
}

/// Paper `id` as it was kept, for its card to go on from where it stopped.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn ai_paper_status(
    doc_path: Option<String>,
    workspace_root: Option<String>,
    id: String,
) -> Result<PaperProgress, String> {
    let root = crate::ai::workspace::project_root(doc_path.as_deref(), workspace_root.as_deref())
        .ok_or_else(|| "NO_PROJECT".to_string())?;
    progress(&root, &id)
}

pub(crate) fn progress(root: &std::path::Path, id: &str) -> Result<PaperProgress, String> {
    let files = load(root, id)?;
    let sections = files.outline.as_ref().map_or(0, |o| o.sections.len());
    let mut drafted = 0;
    for i in 0..sections {
        drafted += load_section(root, id, i)?.is_some() as u32;
    }
    Ok(PaperProgress {
        paper: files.paper,
        outline: files.outline,
        drafted,
    })
}

#[cfg(test)]
mod live;
#[cfg(test)]
mod tests;
