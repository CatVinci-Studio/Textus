//! Scripts: a plugin in one `.js` file in the global `scripts/` folder, its
//! manifest in a header comment:
//!
//! ```js
//! // ==TextusScript==
//! // @name        Word Count
//! // @command     count Count Words
//! // ==/TextusScript==
//! ```
//!
//! Its id is `local.<file name>` unless `@id` gives one.

use std::path::{Path, PathBuf};

use serde_json::json;

use super::{install::InstalledPlugin, require_id};

const START: &str = "==TextusScript==";
const END: &str = "==/TextusScript==";

/// `scripts/` in the global config folder.
pub(super) fn scripts_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(crate::ai::workspace::global_agent_dir(app)?.join("scripts"))
}

/// The `// @key value` lines between the markers, in order.
fn header(text: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let mut inside = false;
    for line in text.lines() {
        let Some(rest) = line.trim().strip_prefix("//") else {
            if inside {
                break;
            }
            continue;
        };
        let rest = rest.trim();
        if rest == START {
            inside = true;
        } else if rest == END {
            break;
        } else if inside {
            if let Some(field) = rest.strip_prefix('@') {
                let (key, value) = field.split_once(char::is_whitespace).unwrap_or((field, ""));
                out.push((key.to_string(), value.trim().to_string()));
            }
        }
    }
    out
}

/// A file name as the part of an id after `local.`.
fn id_part(stem: &str) -> String {
    let mut part: String = stem
        .to_ascii_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    while part.contains("--") {
        part = part.replace("--", "-");
    }
    part.trim_matches('-').to_string()
}

/// The manifest a script's header makes, and its id; None for a file with
/// no header, or an id that can't be one.
pub(super) fn script_manifest(file: &Path, text: &str) -> Option<(String, String)> {
    let fields = header(text);
    if fields.is_empty() {
        return None;
    }
    let stem = file.file_stem()?.to_str()?;
    let one = |key: &str| {
        fields
            .iter()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.clone())
    };
    let all = |key: &str| {
        fields
            .iter()
            .filter(|(k, _)| k == key)
            .map(|(_, v)| v.clone())
            .collect::<Vec<_>>()
    };
    let id = one("id").unwrap_or_else(|| format!("local.{}", id_part(stem)));
    require_id(&id).ok()?;
    let publisher = id.split_once('.')?.0.to_string();
    let commands: Vec<_> = all("command")
        .iter()
        .filter_map(|line| {
            let (name, title) = line.split_once(char::is_whitespace)?;
            Some(json!({ "command": format!("{id}.{name}"), "title": title.trim() }))
        })
        .collect();
    let manifest = json!({
        "id": id,
        "name": one("name").unwrap_or_else(|| stem.to_string()),
        "version": one("version").unwrap_or_else(|| "0.1.0".to_string()),
        "publisher": publisher,
        "description": one("description").unwrap_or_default(),
        "engines": { "textus": "^1.3.0" },
        "main": file.file_name()?.to_str()?,
        "permissions": all("permission"),
        "activationEvents": ["onStartupFinished"],
        "contributes": { "commands": commands },
    });
    Some((id, serde_json::to_string_pretty(&manifest).ok()?))
}

/// Every script in the folder that has a header, by id.
pub(super) fn scripts(app: &tauri::AppHandle) -> Vec<InstalledPlugin> {
    let Ok(dir) = scripts_dir(app) else {
        return Vec::new();
    };
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut out: Vec<InstalledPlugin> = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("js") {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(&path) else {
            continue;
        };
        if let Some((id, manifest)) = script_manifest(&path, &text) {
            if !out.iter().any(|p| p.id == id) {
                out.push(InstalledPlugin {
                    id,
                    dir: dir.to_string_lossy().to_string(),
                    manifest,
                    dev: true,
                });
            }
        }
    }
    out
}

/// The script file with id `id`, if there is one.
pub(super) fn script_file(app: &tauri::AppHandle, id: &str) -> Option<PathBuf> {
    let dir = scripts_dir(app).ok()?;
    std::fs::read_dir(&dir).ok()?.flatten().find_map(|entry| {
        let path = entry.path();
        let text = std::fs::read_to_string(&path).ok()?;
        (script_manifest(&path, &text)?.0 == id).then_some(path)
    })
}

/// Settings › Plugins › Open Scripts Folder: made if it isn't there.
#[cfg(desktop)]
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn plugin_open_scripts_dir(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let dir = scripts_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const SCRIPT: &str = "// ==TextusScript==\n\
        // @name        Word Count\n\
        // @description Counts words.\n\
        // @permission  editor.read\n\
        // @permission  files.read\n\
        // @command     count Count Words\n\
        // ==/TextusScript==\n\
        exports.activate = () => {};\n";

    #[test]
    fn a_header_makes_a_manifest() {
        let (id, manifest) = script_manifest(Path::new("/s/Word Count.js"), SCRIPT).unwrap();
        assert_eq!(id, "local.word-count");
        let m: serde_json::Value = serde_json::from_str(&manifest).unwrap();
        assert_eq!(m["name"], "Word Count");
        assert_eq!(m["publisher"], "local");
        assert_eq!(m["main"], "Word Count.js");
        assert_eq!(m["permissions"], json!(["editor.read", "files.read"]));
        assert_eq!(
            m["contributes"]["commands"],
            json!([{ "command": "local.word-count.count", "title": "Count Words" }])
        );
    }

    #[test]
    fn an_id_can_be_given_and_must_be_good() {
        let text = SCRIPT.replace("@name", "@id jane.counter\n// @name");
        let (id, _) = script_manifest(Path::new("/s/x.js"), &text).unwrap();
        assert_eq!(id, "jane.counter");
        let bad = SCRIPT.replace("@name", "@id Not An Id\n// @name");
        assert!(script_manifest(Path::new("/s/x.js"), &bad).is_none());
    }

    #[test]
    fn a_file_with_no_header_is_no_script() {
        assert!(script_manifest(Path::new("/s/x.js"), "exports.activate = () => {};").is_none());
    }
}
