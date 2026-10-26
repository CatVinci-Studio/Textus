//! read_plugin: Create mode's look at the plugins installed - the list,
//! one plugin's manifest and files, one file's text - so a plugin is
//! changed from its own code in any conversation, not written again from
//! a description. Read-only: what the model changes comes back as files in
//! its reply, and an official plugin's change is a copy of the user's own
//! (the `plugin` skill).

use super::install::{plugins_installed, InstalledPlugin};
use crate::ai::agent::AgentMode;
use crate::ai::tools::{Access, Run, Tool};
use aicompat::agent::ToolSpec;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

pub const READ_PLUGIN_TOOL_NAME: &str = "read_plugin";

/// Only in Create mode: the other modes work on the document.
const CREATE_MODE: &[AgentMode] = &[AgentMode::Create];
/// The most of one file the model is shown, in characters.
const FILE_CHARS: usize = 60_000;
/// The most files a plugin's list shows.
const LISTED_FILES: usize = 200;

fn spec() -> ToolSpec {
    ToolSpec {
        name: READ_PLUGIN_TOOL_NAME.into(),
        description: "Read the plugins the user has installed, to change one from its own code. No `id`: the list. An `id`: its manifest and its files. An `id` and a `path` (as the list gives it): that file's text.".into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "id": { "type": "string", "description": "The plugin's id, e.g. catvinci.tasks." },
                "path": { "type": "string", "description": "A file of the plugin, relative to its folder, e.g. host.js." }
            },
        }),
    }
}

/// The tool over the plugins installed when the request starts; None when
/// they can't be listed.
pub(crate) fn read_plugin_tool<'a>(app: &tauri::AppHandle) -> Option<Tool<'a>> {
    Some(read_plugin_tool_over(plugins_installed(app.clone()).ok()?))
}

/// The tool over `installed` (the live eval's, from a checkout).
pub(crate) fn read_plugin_tool_over<'a>(installed: Vec<InstalledPlugin>) -> Tool<'a> {
    Tool {
        spec: spec(),
        access: Access::ReadOnly,
        modes: CREATE_MODE,
        run: Run::Async(Box::new(move |call| {
            let installed = installed.clone();
            Box::pin(async move { answer(&installed, &call.arguments).into() })
        })),
    }
}

/// The answer to one call.
pub(crate) fn answer(installed: &[InstalledPlugin], arguments: &str) -> String {
    let args: Value = serde_json::from_str(arguments).unwrap_or_default();
    let id = args["id"].as_str().unwrap_or("").trim();
    let path = args["path"].as_str().unwrap_or("").trim();
    if id.is_empty() {
        return list(installed);
    }
    let Some(plugin) = installed.iter().find(|p| p.id == id) else {
        return format!("No plugin `{id}` is installed.\n\n{}", list(installed));
    };
    let dir = Path::new(&plugin.dir);
    if path.is_empty() {
        let files = files_of(dir);
        return format!(
            "Plugin `{id}` ({}). Its manifest, textus-plugin.json:\n{}\n\nIts files:\n{}",
            describe(plugin),
            plugin.manifest.trim(),
            files.join("\n")
        );
    }
    match read_file(dir, path) {
        Ok(text) => format!("`{id}`'s {path}:\n{text}"),
        Err(why) => format!("{why} Its files:\n{}", files_of(dir).join("\n")),
    }
}

/// "name 1.2.0 by publisher, official" - what the manifest says of it.
fn describe(plugin: &InstalledPlugin) -> String {
    let m: Value = serde_json::from_str(&plugin.manifest).unwrap_or_default();
    let field = |k: &str| m[k].as_str().unwrap_or("").to_string();
    let publisher = field("publisher");
    let whose = if publisher == "local" {
        "the user's own, made in Create mode - change it in place, keeping its id".to_string()
    } else {
        format!("by {publisher} - a change is a copy of the user's own, as the plugin skill says")
    };
    format!("{} {}, {whose}", field("name"), field("version"))
}

fn list(installed: &[InstalledPlugin]) -> String {
    if installed.is_empty() {
        return "No plugin is installed.".to_string();
    }
    let lines: Vec<String> = installed
        .iter()
        .map(|p| format!("- {}: {}", p.id, describe(p)))
        .collect();
    format!("The plugins installed:\n{}", lines.join("\n"))
}

/// Its files, relative to `dir`, with sizes - not a checkout's packages.
fn files_of(dir: &Path) -> Vec<String> {
    let mut out = Vec::new();
    walk(dir, dir, &mut out);
    out.sort();
    if out.len() > LISTED_FILES {
        let more = out.len() - LISTED_FILES;
        out.truncate(LISTED_FILES);
        out.push(format!("(and {more} more)"));
    }
    out
}

fn walk(root: &Path, dir: &Path, out: &mut Vec<String>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with('.') || name == "node_modules" {
            continue;
        }
        if path.is_dir() {
            walk(root, &path, out);
        } else if let Ok(rel) = path.strip_prefix(root) {
            let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
            out.push(format!(
                "{} ({size} bytes)",
                rel.to_string_lossy().replace('\\', "/")
            ));
        }
    }
}

/// A file's text, when `rel` is a text file inside `dir`.
fn read_file(dir: &Path, rel: &str) -> Result<String, String> {
    let rel = rel.split(" (").next().unwrap_or(rel);
    let target: PathBuf = dir.join(rel);
    let inside = match (dir.canonicalize(), target.canonicalize()) {
        (Ok(root), Ok(file)) => file.starts_with(root) && file.is_file(),
        _ => false,
    };
    if !inside {
        return Err(format!("`{rel}` isn't a file of this plugin."));
    }
    let bytes = std::fs::read(&target).map_err(|e| e.to_string())?;
    let text = String::from_utf8(bytes).map_err(|_| format!("`{rel}` isn't text."))?;
    Ok(match text.char_indices().nth(FILE_CHARS) {
        Some((cut, _)) => format!("{}\n… (cut at {FILE_CHARS} characters)", &text[..cut]),
        None => text,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plugin(dir: &Path, id: &str, publisher: &str) -> InstalledPlugin {
        let manifest =
            json!({ "id": id, "name": "Tasks", "version": "1.1.0", "publisher": publisher })
                .to_string();
        std::fs::create_dir_all(dir.join("lib")).unwrap();
        std::fs::write(dir.join("textus-plugin.json"), &manifest).unwrap();
        std::fs::write(dir.join("host.js"), "exports.activate = () => {};").unwrap();
        std::fs::write(dir.join("lib/a.js"), "x").unwrap();
        std::fs::write(dir.join("icon.png"), [0x89u8, 0x50, 0xff, 0xfe]).unwrap();
        InstalledPlugin {
            id: id.into(),
            dir: dir.to_string_lossy().into_owned(),
            manifest,
            dev: false,
        }
    }

    #[test]
    fn the_model_reads_the_list_a_plugin_and_its_files() {
        let tmp = tempfile::tempdir().unwrap();
        let tasks = plugin(&tmp.path().join("tasks"), "catvinci.tasks", "catvinci");
        let mine = plugin(&tmp.path().join("mine"), "local.mine", "local");
        let all = vec![tasks, mine];
        let listed = answer(&all, "{}");
        assert!(listed.contains("- catvinci.tasks: Tasks 1.1.0, by catvinci - a change is a copy"));
        assert!(listed.contains("- local.mine: Tasks 1.1.0, the user's own"));
        let one = answer(&all, r#"{"id":"catvinci.tasks"}"#);
        assert!(one.contains("\"publisher\":\"catvinci\"") && one.contains("host.js (28 bytes)"));
        assert!(one.contains("lib/a.js (1 bytes)"));
        let file = answer(&all, r#"{"id":"catvinci.tasks","path":"host.js"}"#);
        assert!(file.ends_with("exports.activate = () => {};"));
        // Not text, not its own, not there.
        assert!(answer(&all, r#"{"id":"catvinci.tasks","path":"icon.png"}"#).contains("isn't text"));
        assert!(
            answer(&all, r#"{"id":"catvinci.tasks","path":"../mine/host.js"}"#)
                .contains("isn't a file of this plugin")
        );
        assert!(answer(&all, r#"{"id":"x.y"}"#).starts_with("No plugin `x.y`"));
    }
}
