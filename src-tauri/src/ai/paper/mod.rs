//! The long-form paper agent: a topic researched, outlined, approved by the
//! user, then drafted section by section (docs/design/ai-paper.md). This
//! module holds what the stages share - the paper, its research dossier and
//! outline, the research budget - and how they are kept on disk. Its shapes
//! are generated into src/platform/bindings/ai-paper.ts (`npm run bindings`).

mod budget;
mod checks;
mod choose;
mod draft;
pub mod drafting;
mod events;
mod finish;
mod genre;
mod handover;
mod model;
mod notes;
mod outline;
mod research;
mod review;
mod sources;
pub mod status;
mod store;
mod stream;
mod timeline;
mod web_figures;

use crate::ai::agent::Session;
use budget::KeepSpent;
pub(crate) use budget::{BudgetCounts, ResearchBudget, SharedBudget};
pub(crate) use events::{PaperEvent, PaperPhase, SectionStatus, SourceEntry};
pub use genre::{Genre, GenreForm};
#[cfg(test)]
use status::progress;
pub(crate) use store::{
    clear_sections, load, load_section, new_id, paper_root, save, save_section, PaperFiles,
};

use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;

/// The folder paper `id` is kept in, in the session's project; None for a
/// new id.
fn session_root(session: &Session, id: Option<&str>) -> Result<std::path::PathBuf, String> {
    paper_root(session.app, session.doc_path, session.workspace_root, id)
}

/// One paper being written. Kept as `.textus/papers/<id>/paper.json`.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct Paper {
    pub id: String,
    pub topic: String,
    /// What kind of piece it is; a paper kept before genres is a paper.
    #[serde(default)]
    pub genre: Genre,
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
    /// What every request names: provider, project, image model, the
    /// conversation whose attached files its research reads (copied into
    /// the paper's folder when it starts, so going on with it needs none).
    #[serde(flatten)]
    pub request: crate::ai::agent::AgentRequest,
    /// The paper to go on with, or the id a new one is kept under; None
    /// for a new id.
    pub id: Option<String>,
    pub topic: String,
    /// What kind of piece to write; None for the model to choose from the
    /// topic.
    #[serde(default)]
    pub genre: Option<Genre>,
    /// The language it is written in, a BCP 47 tag.
    pub language: String,
    /// Its length in characters; None for the genre's, or the model's
    /// choice.
    #[serde(default)]
    pub target_chars: Option<u32>,
}

/// Researches and outlines a paper on `topic` in the document's project,
/// kept in `.textus/papers/<id>/`; a paper begun before goes on from what
/// it kept. Stopped like any request, by `ai_cancel` with `request_id`.
#[tauri::command]
pub async fn ai_paper_run(
    app: tauri::AppHandle,
    request: PaperRequest,
    channel: Channel<crate::ai::agent::StreamEvent>,
) -> Result<Paper, String> {
    let PaperRequest {
        request,
        id,
        topic,
        genre,
        language,
        target_chars,
    } = request;
    let session = request.session(&app)?;
    let root = session_root(&session, id.as_deref())?;
    let project = crate::ai::workspace::project_root(session.doc_path, session.workspace_root);
    let entry = session.entry;
    // A paper begun before goes on from what it kept: its research, its
    // outline, what its research may still spend.
    let kept = id.as_deref().and_then(|id| load(&root, id).ok());
    // As many pictures as one send may make, the paper's own limit aside:
    // the outline plans no more than can be drawn.
    let mut research_budget = kept
        .as_ref()
        .map_or_else(ResearchBudget::for_paper, |f| f.paper.budget.renewed());
    let mut images = research_budget.limits.images;
    let image_cap = session
        .pictures(request.image_model.as_ref())
        .map_or(0, |run| run.limit as u32);
    research_budget.limits.images = images.min(image_cap);
    let budget = std::sync::Arc::new(SharedBudget::new(research_budget));
    let native = session.native_search();
    let service = request.search_service(&app);
    let can_search = native.is_some() || service.is_some();
    let web = crate::ai::web::WebPlan::new(true, native, service, &[]).with_budget(budget.clone());
    let send = |event: PaperEvent| {
        crate::ai::agent::EventSink::send(&channel, crate::ai::agent::StreamEvent::Paper { event });
    };
    send(PaperEvent::WebSearch {
        available: can_search,
    });
    crate::ai::cancel::cancellable(request.request_id.clone(), async {
        let agent = session.agent(native).await?;
        let agent = model::Metered {
            inner: &agent,
            budget: &budget,
        };
        let mut files = match kept {
            Some(kept) => kept,
            None => {
                let (genre, target_chars) = match genre {
                    Some(genre) => (genre, genre.length(target_chars)),
                    None => choose::choose(&agent, &topic, target_chars).await,
                };
                let mut limits = ResearchBudget::for_genre(genre).limits;
                images = limits.images;
                limits.images = images.min(image_cap);
                budget.limit(limits);
                send(PaperEvent::Genre {
                    genre,
                    target_chars,
                    form: genre.form(),
                });
                PaperFiles {
                    paper: Paper {
                        id: id.unwrap_or_else(new_id),
                        topic,
                        genre,
                        language,
                        target_chars,
                        budget: budget.snapshot(),
                        stage: PaperStage::Researching,
                    },
                    dossier: Dossier::default(),
                    outline: None,
                }
            }
        };
        // Kept at once, so a paper stopped while researching is found and
        // begun again.
        save(&root, &files)?;
        let conversation = crate::ai::scratch::with_attachments(request.conversation.as_deref());
        let paper_folder =
            store::keep_attachments(&root, &files.paper.id, conversation.as_deref())?;
        let mut keep_spent = KeepSpent {
            root: &root,
            id: files.paper.id.clone(),
            budget: budget.clone(),
            images,
            done: false,
        };
        if files.dossier.notes.is_empty() {
            let ctx = research::context(
                project.as_deref(),
                paper_folder.as_deref(),
                entry.supports_vision,
            );
            let tools = research::shared_tools(
                project.as_deref(),
                paper_folder.is_some(),
                entry.supports_vision,
                crate::ai::agent::installed_tools(&app).await,
            );
            let kit = research::Kit {
                tools: &tools,
                ctx: &ctx,
            };
            let dossier =
                research::research(&agent, &files.paper, &web, &budget, &send, &kit).await?;
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
                // Outlined, like everything written, as the user asks of
                // their writing; researched plainly.
                let guidance = session.guidance(&files.paper.topic);
                let guided = crate::ai::agent::Guided {
                    inner: &agent,
                    guidance: &guidance,
                };
                outline::make_outline(&guided, &files.paper, &files.dossier, &send).await?
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

#[cfg(test)]
mod live;
#[cfg(test)]
mod research_tests;
#[cfg(test)]
mod tests;
