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
    /// What every request names; its image model is the one the paper's
    /// pictures are made with.
    #[serde(flatten)]
    pub request: crate::ai::agent::AgentRequest,
    /// The paper, outlined and its outline approved.
    pub id: String,
    /// Every cited sentence checked against its notes before the review's
    /// revision (the user's choice; slower, one more call a section).
    #[serde(default)]
    pub check_claims: bool,
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
    let DraftRequest {
        request,
        id,
        check_claims,
    } = request;
    let session = request.session(&app)?;
    let root = super::session_root(&session, Some(&id))?;
    let files = load(&root, &id)?;
    let outline = files
        .outline
        .clone()
        .ok_or_else(|| "This paper has no outline yet.".to_string())?;
    let send = |event: PaperEvent| {
        let _ = channel.send(event);
    };
    // Each section's diagrams and charts are drawn by the window it is
    // written for before it is kept.
    let figures_channel = channel.clone();
    let draw = figures::by_window(move |event| figures_channel.send(event).is_ok());
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
        let agent = crate::ai::agent::Guided {
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
        let mut finished = |i: usize, markdown: &str| {
            save_section(&root, &files.paper.id, i, markdown)?;
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
        let mut sections = draft::draft(
            &agent,
            &files.paper,
            &outline,
            &files.dossier,
            &written,
            &started,
            &mut finished,
            &send,
            Some(&draw),
        )
        .await?;

        // Reviewed before a stop: its kept sections are the revised ones.
        if files.paper.stage != PaperStage::Reviewed {
            send(PaperEvent::Phase {
                phase: PaperPhase::Reviewing,
            });
            // A review that fails costs the paper nothing: its sections
            // passed their own checks.
            let issues = review::review_all(
                &agent,
                &files.paper,
                &outline,
                &files.dossier,
                &sections,
                check_claims,
            )
            .await;
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
                Some(&draw),
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
        let mut sections = web_figures::resolve(&sections, web_figures::find_on_commons).await;
        // Pictures begun before the figures are numbered, so one that can't
        // be made leaves no caption behind.
        let pictures = session.pictures(&request);
        for section in &mut sections {
            *section = match &pictures {
                Some(run) => crate::ai::images::place_pictures(run, section).0,
                None => finish::without_pictures(section),
            };
        }
        // A figure no check saw drawn is drawn now, and taken out if it
        // can't be: the paper never shows a diagram or chart as its code.
        for section in &mut sections {
            *section = figures::drawable(Some(&draw), section).await;
        }
        finish::number_figures(&mut sections, language);
        // Numbered first, so only the sources cited are looked up.
        let mut dossier = finish::number_citations(&mut sections, &files.dossier);
        let plain: Vec<String> = sections
            .iter()
            .map(|s| finish::plain_citations(s))
            .collect();
        // The opening reads the text, not the reference list: it is written
        // while the sources' titles are looked up.
        let ((), opening) = futures_util::future::join(
            finish::title_sources(&mut dossier),
            finish::opening(&agent, &files.paper, &outline, &plain),
        )
        .await;
        let references = finish::references(
            &sections,
            &dossier,
            finish::references_heading(language, files.paper.genre),
        );
        let sections = plain;
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
