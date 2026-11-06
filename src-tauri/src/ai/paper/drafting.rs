//! Drafting an outlined paper: its command, from the approved outline to
//! the finished text sent to the editor.

use super::*;
use tauri::ipc::Channel;

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
    let session = Session::open(
        &app,
        &request.provider,
        request.model.clone(),
        request.doc_path.as_deref(),
        request.workspace_root.as_deref(),
    )?;
    let root = session.root(Some(&request.id))?;
    let files = load(&root, &request.id)?;
    let outline = files
        .outline
        .clone()
        .ok_or_else(|| "This paper has no outline yet.".to_string())?;
    let send = |event: PaperEvent| {
        let _ = channel.send(event);
    };
    crate::ai::cancel::cancellable(request.request_id.clone(), async {
        let agent = session.agent(None).await?;
        let throttled = throttle::Throttled::new(&agent, session.entry.paper_at_once);
        let budget = std::sync::Arc::new(SharedBudget::new(files.paper.budget.renewed()));
        let mut keep_spent = KeepSpent {
            root: &root,
            id: files.paper.id.clone(),
            budget: budget.clone(),
            images: files.paper.budget.limits.images,
            done: false,
        };
        let metered = model::Metered {
            inner: &throttled,
            budget: &budget,
        };
        let guidance = session.guidance(&files.paper.topic);
        let agent = model::Guided {
            inner: &metered,
            guidance: &guidance,
        };
        send(PaperEvent::Sources {
            heading: finish::references_heading(&files.paper.language, files.paper.genre).into(),
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
            if metered.spent() {
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
        let pictures = session.pictures(request.image_model.as_ref());
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
        let references = finish::references(
            &sections,
            &dossier,
            finish::references_heading(language, files.paper.genre),
        );
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
