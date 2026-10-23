//! Writing conventions as the app uses them: the effective profile for a
//! document (the project's `.textus/style.md` front matter, then the
//! `writingConventions` setting, then Automatic - rules::profile), and the
//! commands the frontend calls for the settings row, an offline document
//! check and platform counts.

use crate::ai::rules::{self, measure, profile, Conventions, DocReport, Lang, Level, Profile};
use crate::ai::workspace::{self, AgentWorkspace};
use serde::Serialize;
use tauri::AppHandle;

/// The conventions for documents in `ws`: the global setting as stored in
/// settings.json, and the project's style-profile front matter.
pub(crate) fn for_workspace(app: &AppHandle, ws: &AgentWorkspace) -> Conventions {
    Conventions {
        setting: crate::settings::read_setting(app, profile::SETTING_KEY),
        project: ws.conventions.clone(),
    }
}

/// The library's names and aliases, which shared.library-name checks.
pub(crate) fn library_names(ws: &AgentWorkspace) -> Vec<String> {
    ws.library
        .iter()
        .flat_map(|e| std::iter::once(e.name.clone()).chain(e.aliases.iter().cloned()))
        .collect()
}

/// The setting's key, its "automatic" value, the profiles each language
/// offers (with the one Automatic uses) and the option keys - everything
/// the Settings row needs to offer the choice.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn writing_conventions_options() -> profile::ConventionsOptions {
    profile::options()
}

#[derive(Serialize)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct EffectiveConventions {
    /// The document's language, when a document was given and has enough
    /// prose to tell.
    pub lang: Option<Lang>,
    /// The profile that document follows.
    pub profile: Option<Profile>,
    /// The profile each language would follow in this project.
    pub by_language: Vec<Profile>,
}

/// The effective writing conventions for a document: per language, and
/// for the document's own language when `document` is given.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn writing_conventions_effective(
    app: AppHandle,
    doc_path: Option<String>,
    workspace_root: Option<String>,
    document: Option<String>,
) -> EffectiveConventions {
    let ws = tauri::async_runtime::spawn_blocking({
        let app = app.clone();
        move || workspace::load(&app, doc_path.as_deref(), workspace_root.as_deref())
    })
    .await
    .unwrap_or_default();
    let conv = for_workspace(&app, &ws);
    let lang = document.as_deref().and_then(rules::detect::detect);
    EffectiveConventions {
        lang,
        profile: lang.map(|l| conv.profile_for(l)),
        by_language: Lang::ALL.iter().map(|&l| conv.profile_for(l)).collect(),
    }
}

/// Checks a whole document against its writing conventions, offline (no
/// AI provider): the findings check_conventions gives the agent, with
/// offsets and lines into the Markdown, for a "Check conventions" command.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn conventions_check_document(
    app: AppHandle,
    document: String,
    doc_path: Option<String>,
    workspace_root: Option<String>,
    strictness: Option<String>,
) -> DocReport {
    tauri::async_runtime::spawn_blocking(move || {
        let ws = workspace::load(&app, doc_path.as_deref(), workspace_root.as_deref());
        let conv = for_workspace(&app, &ws);
        rules::check_document(
            &document,
            &conv,
            Level::from_setting(strictness.as_deref()),
            &library_names(&ws),
        )
    })
    .await
    .unwrap_or(DocReport {
        lang: None,
        profile: None,
        findings: Vec::new(),
    })
}

/// Exact platform counts (X weighted length, Bluesky graphemes, WeChat
/// titles...) - rules::measure::METRICS lists the metrics. None for an
/// unknown metric.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn measure_text(text: String, metric: String) -> Option<measure::Measure> {
    measure::measure(&text, &metric)
}
