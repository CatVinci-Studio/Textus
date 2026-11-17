//! The file types plugins that are on open as documents
//! (`contributes.documentTypes`): Markdown in another dress, so search, the
//! AI's file list and the folder's metadata read them as Markdown too.

use std::sync::RwLock;

static EXTENSIONS: RwLock<Vec<String>> = RwLock::new(Vec::new());

/// Whether `ext` (lowercase, no dot) is a plugin's document type now.
pub(crate) fn is_plugin_document(ext: &str) -> bool {
    !ext.is_empty()
        && EXTENSIONS
            .read()
            .is_ok_and(|list| list.iter().any(|e| e == ext))
}

/// The plugins' document types now, in name order.
pub(crate) fn plugin_document_extensions() -> Vec<String> {
    EXTENSIONS
        .read()
        .map(|list| list.clone())
        .unwrap_or_default()
}

/// The extensions a manifest's `contributes.documentTypes` names, as
/// `extension_of` spells them.
fn extensions_in(manifest: &str) -> Vec<String> {
    let Ok(json) = serde_json::from_str::<serde_json::Value>(manifest) else {
        return Vec::new();
    };
    json.pointer("/contributes/documentTypes")
        .and_then(|v| v.as_array())
        .into_iter()
        .flatten()
        .filter_map(|t| t.get("extensions")?.as_array())
        .flatten()
        .filter_map(|e| e.as_str())
        .map(|e| e.trim_start_matches('.').to_lowercase())
        .filter(|e| !e.is_empty())
        .collect()
}

/// Reads the list again from the plugins that are on: at startup and after
/// any plugin is turned on or off, installed or removed.
pub(crate) fn refresh(app: &tauri::AppHandle) {
    let state = super::state::read(app);
    let mut found: Vec<String> = super::install::plugins_installed(app.clone())
        .unwrap_or_default()
        .into_iter()
        .filter(|p| state.runs(&p.id))
        .flat_map(|p| extensions_in(&p.manifest))
        .collect();
    found.sort();
    found.dedup();
    if let Ok(mut list) = EXTENSIONS.write() {
        *list = found;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_extensions_a_manifest_names() {
        let manifest = r#"{"contributes":{"documentTypes":[
            {"extensions":["qmd", ".RMD"]},{"extensions":[]},{"keep":{}}]}}"#;
        assert_eq!(extensions_in(manifest), ["qmd", "rmd"]);
        assert!(extensions_in("{}").is_empty());
        assert!(extensions_in("not json").is_empty());
    }

    #[test]
    fn a_listed_extension_is_a_document() {
        *EXTENSIONS.write().unwrap() = vec!["qmd".into()];
        assert!(is_plugin_document("qmd"));
        assert!(!is_plugin_document("md"));
        assert!(!is_plugin_document(""));
        EXTENSIONS.write().unwrap().clear();
    }
}
