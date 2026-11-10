//! Writing conventions as the app uses them: the effective profile for a
//! document (style.md front matter, then the setting, then Automatic), and
//! platform counts.

use crate::ai::rules::{measure, profile, Conventions};
use crate::ai::workspace::AgentWorkspace;
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

/// Exact platform counts (X weighted length, Bluesky graphemes...). None for
/// an unknown metric.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn measure_text(text: String, metric: String) -> Option<measure::Measure> {
    measure::measure(&text, &metric)
}
