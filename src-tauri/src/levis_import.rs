//! Importing a Levis installation (Textus's name before 1.0.0, identifier
//! `com.chengaoshen.levis`) - docs/dev/storage.md, "Importing Levis data".
//!
//! Textus has its own identifier, so its directories start empty. Since
//! Levis 0.9.7 everything Levis remembers is a plain file in its config and
//! data directories - the siblings of Textus's own - so the import copies:
//!
//! - settings, UI state and both histories, merged into Textus's (Levis's
//!   value wins for every settings field it has; history entries join);
//! - imported themes, the global writing instructions and skills, File >
//!   Open Recent, the last session, window size, unsaved-document drafts and
//!   pasted images - each file Textus doesn't have yet;
//! - with the user's consent, API keys, the custom endpoint and the
//!   ChatGPT / Claude sign-ins - again only what Textus doesn't have, and
//!   kept owner-only.
//!
//! Levis's files are only ever read: nothing there is moved, changed or
//! deleted, so Levis keeps working alongside. Not on iOS, where each app's
//! container is closed to every other app.

use serde::Serialize;
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};

use crate::settings::{LegacyPayload, Stores};

/// Levis's app identifier: the name of its config and data directories.
pub const LEVIS_IDENTIFIER: &str = "com.chengaoshen.levis";

/// Set in Textus's settings once the first-launch offer was answered (or
/// the import ran), so the offer is made once; Settings keeps the button.
pub const OFFERED_SETTING: &str = "levisImportOffered";

/// Files copied with the user's consent only (config directory).
const CREDENTIAL_FILES: [&str; 5] = [
    "provider_keys.json",
    "api_key.json",
    "custom_endpoint.json",
    "auth-codex.json",
    "auth-claude.json",
];

/// What the import can bring, named for the UI (src/settings/levis-import.ts
/// has the labels).
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub enum Item {
    Settings,
    ChatHistory,
    ClipboardHistory,
    Themes,
    WritingInstructions,
    Skills,
    RecentFiles,
    Session,
    Drafts,
    Credentials,
}

/// Levis's directories, next to Textus's: `<parent>/com.chengaoshen.levis`
/// for both the config and the data directory (the same directory on macOS
/// and Windows).
#[derive(Clone, Debug)]
pub struct Dirs {
    pub config: PathBuf,
    pub data: PathBuf,
}

impl Dirs {
    pub fn beside(textus_config: &Path, textus_data: &Path) -> Option<Self> {
        Some(Self {
            config: textus_config.parent()?.join(LEVIS_IDENTIFIER),
            data: textus_data.parent()?.join(LEVIS_IDENTIFIER),
        })
    }
}

#[derive(Serialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// Importing is possible on this platform (not on iOS).
    pub supported: bool,
    /// Levis's config directory, for the UI to show.
    pub levis_dir: Option<String>,
    /// What Levis has that can be imported; empty: nothing to import.
    pub items: Vec<Item>,
}

#[derive(Serialize, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    /// What was brought over.
    pub imported: Vec<Item>,
    /// Files Textus already had, left as they were (relative paths).
    pub kept: Vec<String>,
    /// Files that could not be copied, with the reason.
    pub failed: Vec<String>,
}

fn non_empty_dir(dir: &Path) -> bool {
    std::fs::read_dir(dir).is_ok_and(|mut entries| entries.next().is_some())
}

fn has_md_files(dir: &Path) -> bool {
    std::fs::read_dir(dir).is_ok_and(|entries| {
        entries
            .flatten()
            .any(|e| e.path().extension().is_some_and(|x| x == "md"))
    })
}

fn list_len(path: &Path) -> usize {
    crate::settings::read_store_file(path, "entries", &json!([]))
        .and_then(|v| v.as_array().map(Vec::len))
        .unwrap_or(0)
}

/// What a Levis installation in `levis` has to offer.
pub fn items(levis: &Dirs) -> Vec<Item> {
    let mut items = Vec::new();
    let config = &levis.config;
    let data = &levis.data;
    if config.join("settings.json").is_file() {
        items.push(Item::Settings);
    }
    if list_len(&data.join("chat-history.json")) > 0 {
        items.push(Item::ChatHistory);
    }
    if list_len(&data.join("clipboard-history.json")) > 0 {
        items.push(Item::ClipboardHistory);
    }
    if non_empty_dir(&config.join("themes")) {
        items.push(Item::Themes);
    }
    if std::fs::read_to_string(config.join("agent/agent.md")).is_ok_and(|t| {
        !crate::ai::workspace::strip_html_comments(&t)
            .trim()
            .is_empty()
    }) {
        items.push(Item::WritingInstructions);
    }
    if has_md_files(&config.join("agent/skills")) {
        items.push(Item::Skills);
    }
    if config.join("recent_files.json").is_file() {
        items.push(Item::RecentFiles);
    }
    if config.join("session.json").is_file() {
        items.push(Item::Session);
    }
    if non_empty_dir(&data.join("drafts")) || non_empty_dir(&data.join("assets")) {
        items.push(Item::Drafts);
    }
    if CREDENTIAL_FILES.iter().any(|f| config.join(f).is_file()) {
        items.push(Item::Credentials);
    }
    items
}

/// Copies one file unless `to` exists. Returns whether it copied; a file
/// Textus already has is recorded in `kept`, a failure in `failed`.
fn copy_new(from: &Path, to: &Path, rel: &str, report: &mut Report) -> bool {
    if !from.is_file() {
        return false;
    }
    if to.exists() {
        report.kept.push(rel.to_string());
        return false;
    }
    let result = to
        .parent()
        .map_or(Ok(()), std::fs::create_dir_all)
        .and_then(|()| std::fs::copy(from, to).map(|_| ()));
    match result {
        Ok(()) => true,
        Err(e) => {
            report.failed.push(format!("{rel}: {e}"));
            false
        }
    }
}

/// Copies every file under `from` that `to` doesn't have yet (symlinks are
/// skipped). Returns whether anything was copied.
fn copy_tree(from: &Path, to: &Path, rel: &str, report: &mut Report) -> bool {
    let Ok(entries) = std::fs::read_dir(from) else {
        return false;
    };
    let mut copied = false;
    for entry in entries.flatten() {
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        let name = entry.file_name();
        let child_rel = format!("{rel}/{}", name.to_string_lossy());
        if kind.is_dir() {
            copied |= copy_tree(&entry.path(), &to.join(&name), &child_rel, report);
        } else if kind.is_file() {
            copied |= copy_new(&entry.path(), &to.join(&name), &child_rel, report);
        }
    }
    copied
}

/// Credentials stay readable by their owner only, as Textus writes them.
fn restrict(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    }
    #[cfg(not(unix))]
    let _ = path;
}

fn read_json(path: &Path) -> Option<Value> {
    serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()
}

/// Copies everything Levis has (see the module comment) into Textus's
/// `config` and `data` directories and `stores`. Never writes under `levis`.
pub fn import(
    levis: &Dirs,
    config: &Path,
    data: &Path,
    stores: &Stores,
    include_credentials: bool,
) -> Report {
    let mut report = Report::default();
    let available = items(levis);

    // Settings, UI state, histories: through the stores, which own them.
    let read = |dir: &Path, file: &str, key: &str, empty: Value| {
        crate::settings::read_store_file(&dir.join(file), key, &empty)
    };
    let mut settings = read(&levis.config, "settings.json", "settings", json!({}))
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default();
    settings.insert(OFFERED_SETTING.into(), json!(true));
    let list = |v: Value| v.as_array().cloned();
    stores.import_levis(LegacyPayload {
        settings: Some(settings),
        ui_state: read(&levis.data, "ui-state.json", "state", json!({}))
            .and_then(|v| v.as_object().cloned()),
        chat_history: read(&levis.data, "chat-history.json", "entries", json!([])).and_then(list),
        clipboard_history: read(&levis.data, "clipboard-history.json", "entries", json!([]))
            .and_then(list),
    });
    for item in [Item::Settings, Item::ChatHistory, Item::ClipboardHistory] {
        if available.contains(&item) {
            report.imported.push(item);
        }
    }

    // Themes: the files userThemes (now imported) points at.
    if copy_tree(
        &levis.config.join("themes"),
        &config.join("themes"),
        "themes",
        &mut report,
    ) {
        report.imported.push(Item::Themes);
    }

    // The global writing instructions. Textus's own agent.md may be just the
    // starter template (HTML comments only); that one gives way.
    let agent_from = levis.config.join("agent/agent.md");
    let agent_to = config.join("agent/agent.md");
    if available.contains(&Item::WritingInstructions) {
        let textus_has_some = std::fs::read_to_string(&agent_to).is_ok_and(|t| {
            !crate::ai::workspace::strip_html_comments(&t)
                .trim()
                .is_empty()
        });
        if textus_has_some {
            report.kept.push("agent/agent.md".into());
        } else {
            let result = std::fs::create_dir_all(config.join("agent"))
                .and_then(|()| std::fs::copy(&agent_from, &agent_to).map(|_| ()));
            match result {
                Ok(()) => report.imported.push(Item::WritingInstructions),
                Err(e) => report.failed.push(format!("agent/agent.md: {e}")),
            }
        }
    }
    if copy_tree(
        &levis.config.join("agent/skills"),
        &config.join("agent/skills"),
        "agent/skills",
        &mut report,
    ) {
        report.imported.push(Item::Skills);
    }

    // File > Open Recent: Textus's own entries first, then Levis's.
    if let Some(Value::Array(levis_recents)) = read_json(&levis.config.join("recent_files.json")) {
        let path = config.join("recent_files.json");
        let mut merged: Vec<Value> = match read_json(&path) {
            Some(Value::Array(list)) => list,
            _ => Vec::new(),
        };
        for entry in levis_recents {
            if entry.is_string() && !merged.contains(&entry) {
                merged.push(entry);
            }
        }
        merged.truncate(10);
        let written = std::fs::create_dir_all(config)
            .and_then(|()| crate::atomic::write_sync(&path, Value::Array(merged).to_string()));
        match written {
            Ok(()) => report.imported.push(Item::RecentFiles),
            Err(e) => report.failed.push(format!("recent_files.json: {e}")),
        }
    }

    if copy_new(
        &levis.config.join("session.json"),
        &config.join("session.json"),
        "session.json",
        &mut report,
    ) {
        report.imported.push(Item::Session);
    }
    // The editor window size; no Item of its own.
    copy_new(
        &levis.config.join("prefs.json"),
        &config.join("prefs.json"),
        "prefs.json",
        &mut report,
    );

    let drafts = copy_tree(
        &levis.data.join("drafts"),
        &data.join("drafts"),
        "drafts",
        &mut report,
    );
    let assets = copy_tree(
        &levis.data.join("assets"),
        &data.join("assets"),
        "assets",
        &mut report,
    );
    if drafts || assets {
        report.imported.push(Item::Drafts);
    }

    if include_credentials {
        let mut any = false;
        // API keys: Levis's join the ones Textus has; Textus's win.
        let keys_from = levis.config.join("provider_keys.json");
        let keys_to = config.join("provider_keys.json");
        if let Some(Value::Object(levis_keys)) = read_json(&keys_from) {
            let mut keys: Map<String, Value> = match read_json(&keys_to) {
                Some(Value::Object(keys)) => keys,
                _ => Map::new(),
            };
            let before = keys.len();
            for (provider, key) in levis_keys {
                keys.entry(provider).or_insert(key);
            }
            if keys.len() > before {
                let written = std::fs::create_dir_all(config).and_then(|()| {
                    crate::atomic::write_sync(&keys_to, Value::Object(keys).to_string())
                });
                match written {
                    Ok(()) => {
                        restrict(&keys_to);
                        any = true;
                    }
                    Err(e) => report.failed.push(format!("provider_keys.json: {e}")),
                }
            } else {
                report.kept.push("provider_keys.json".into());
            }
        }
        for file in &CREDENTIAL_FILES[1..] {
            let to = config.join(file);
            if copy_new(&levis.config.join(file), &to, file, &mut report) {
                restrict(&to);
                any = true;
            }
        }
        if any {
            report.imported.push(Item::Credentials);
        }
    }

    report.imported.sort();
    report.imported.dedup();
    report
}

// ------------------------------------------------------------------ commands

#[cfg(desktop)]
fn dirs(app: &tauri::AppHandle) -> Option<(Dirs, PathBuf, PathBuf)> {
    use tauri::Manager;
    let config = app.path().app_config_dir().ok()?;
    let data = app.path().app_data_dir().ok()?;
    Some((Dirs::beside(&config, &data)?, config, data))
}

/// Whether there is a Levis installation to import, and what it holds.
#[tauri::command]
pub fn levis_import_status(app: tauri::AppHandle) -> Status {
    #[cfg(desktop)]
    {
        let Some((levis, _, _)) = dirs(&app) else {
            return Status::default();
        };
        Status {
            supported: true,
            levis_dir: Some(levis.config.to_string_lossy().into_owned()),
            items: items(&levis),
        }
    }
    #[cfg(not(desktop))]
    {
        let _ = app;
        Status::default()
    }
}

/// Copies the Levis installation in (see `import`), then tells every window.
#[tauri::command]
pub async fn levis_import(
    app: tauri::AppHandle,
    include_credentials: bool,
) -> Result<Report, String> {
    #[cfg(desktop)]
    {
        use tauri::Manager;
        let worker = app.clone();
        let report = tauri::async_runtime::spawn_blocking(move || {
            let (levis, config, data) =
                dirs(&worker).ok_or_else(|| "No app directories.".to_string())?;
            let stores = worker.state::<Stores>();
            Ok::<_, String>(import(&levis, &config, &data, &stores, include_credentials))
        })
        .await
        .map_err(|e| e.to_string())??;
        crate::settings::broadcast_reload(&app);
        crate::menu::rebuild_recent_menu(&app, crate::commands::recents::read_recent_files(&app));
        Ok(report)
    }
    #[cfg(not(desktop))]
    {
        let _ = (app, include_credentials);
        Err("Importing Levis data is not available on this platform.".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("textus-levis-import-{name}-{}", std::process::id()));
        if dir.exists() {
            std::fs::remove_dir_all(&dir).unwrap();
        }
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write(path: &Path, text: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }

    /// Every file under `dir` with its contents, to prove Levis's side is
    /// left exactly as it was.
    fn snapshot(dir: &Path) -> Vec<(PathBuf, Vec<u8>)> {
        let mut out = Vec::new();
        let mut stack = vec![dir.to_path_buf()];
        while let Some(d) = stack.pop() {
            for e in std::fs::read_dir(&d).unwrap().flatten() {
                let p = e.path();
                if p.is_dir() {
                    stack.push(p);
                } else {
                    out.push((p.clone(), std::fs::read(&p).unwrap()));
                }
            }
        }
        out.sort();
        out
    }

    #[test]
    fn levis_dirs_are_textus_dirs_siblings() {
        let dirs = Dirs::beside(
            Path::new("/home/u/.config/com.catvinci.textus"),
            Path::new("/home/u/.local/share/com.catvinci.textus"),
        )
        .unwrap();
        assert_eq!(
            dirs.config,
            Path::new("/home/u/.config/com.chengaoshen.levis")
        );
        assert_eq!(
            dirs.data,
            Path::new("/home/u/.local/share/com.chengaoshen.levis")
        );
    }

    #[test]
    fn nothing_to_import_without_a_levis_installation() {
        let root = scratch("none");
        let levis = Dirs {
            config: root.join("levis-config"),
            data: root.join("levis-data"),
        };
        assert!(items(&levis).is_empty());
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn imports_a_levis_installation_by_copying_and_never_touches_it() {
        let root = scratch("full");
        let levis = Dirs {
            config: root.join("levis-config"),
            data: root.join("levis-data"),
        };
        let config = root.join("textus-config");
        let data = root.join("textus-data");
        write(
            &levis.config.join("settings.json"),
            r#"{"schemaVersion":1,"settings":{"theme":"dark","fontSize":18,"userThemes":[{"id":"ink"}]}}"#,
        );
        write(
            &levis.data.join("ui-state.json"),
            r#"{"schemaVersion":1,"state":{"agentPanelOpen":true}}"#,
        );
        write(
            &levis.data.join("chat-history.json"),
            r#"{"schemaVersion":1,"entries":[{"id":"a","updatedAt":5,"turns":[]},{"id":"shared","updatedAt":1,"turns":[]}]}"#,
        );
        write(
            &levis.data.join("clipboard-history.json"),
            r#"{"schemaVersion":1,"entries":[{"text":"copied in Levis","at":3}]}"#,
        );
        write(&levis.config.join("themes/ink/light.css"), "body{}");
        write(
            &levis.config.join("agent/agent.md"),
            "Write in British English.",
        );
        write(
            &levis.config.join("agent/skills/house.md"),
            "---\nname: house\n---\nShort.",
        );
        write(
            &levis.config.join("recent_files.json"),
            r#"["/docs/levis.md","/docs/both.md"]"#,
        );
        write(&levis.config.join("session.json"), r#"{"windows":[]}"#);
        write(
            &levis.config.join("prefs.json"),
            r#"{"editor_window_size":[900,700]}"#,
        );
        write(
            &levis.data.join("drafts/tab-1.json"),
            r#"{"tabId":"tab-1"}"#,
        );
        write(&levis.data.join("assets/shot.png"), "png");
        write(
            &levis.config.join("provider_keys.json"),
            r#"{"anthropic":"levis-key","openai":"levis-openai"}"#,
        );
        write(&levis.config.join("auth-codex.json"), r#"{"token":"t"}"#);

        // Textus has already run once: defaults, a key, a recent file, a
        // conversation (one Levis also has), the starter agent.md.
        let own = |stem: &str| crate::settings::file_name(stem);
        write(
            &config.join(own("settings")),
            r#"{"schemaVersion":1,"settings":{"theme":"system","textusOnly":1}}"#,
        );
        write(
            &data.join(own("chat-history")),
            r#"{"schemaVersion":1,"entries":[{"id":"shared","updatedAt":9,"turns":["textus"]}]}"#,
        );
        write(
            &config.join("provider_keys.json"),
            r#"{"openai":"textus-openai"}"#,
        );
        write(
            &config.join("recent_files.json"),
            r#"["/docs/both.md","/docs/textus.md"]"#,
        );
        write(
            &config.join("agent/agent.md"),
            "<!-- starter template -->\n",
        );

        let before = snapshot(&root.join("levis-config"));
        let before_data = snapshot(&root.join("levis-data"));
        let stores = Stores::load(&config, &data);
        assert_eq!(items(&levis).len(), 10);
        let report = import(&levis, &config, &data, &stores, true);

        assert_eq!(
            snapshot(&root.join("levis-config")),
            before,
            "Levis config untouched"
        );
        assert_eq!(
            snapshot(&root.join("levis-data")),
            before_data,
            "Levis data untouched"
        );
        assert!(report.failed.is_empty(), "{:?}", report.failed);
        assert_eq!(report.imported.len(), 10, "{:?}", report.imported);

        let (settings, _) = stores.settings.snapshot();
        assert_eq!(settings["theme"], "dark", "Levis's value wins");
        assert_eq!(settings["fontSize"], 18);
        assert_eq!(settings["textusOnly"], 1, "Textus-only fields stay");
        assert_eq!(settings[OFFERED_SETTING], true);
        assert_eq!(stores.ui_state.snapshot().0["agentPanelOpen"], true);
        let chats = stores.chat.list();
        let ids: Vec<_> = chats
            .as_array()
            .unwrap()
            .iter()
            .map(|c| c["id"].as_str().unwrap())
            .collect();
        assert_eq!(ids, ["shared", "a"]);
        assert_eq!(
            stores.chat.get("shared").unwrap()["turns"][0],
            "textus",
            "Textus's copy wins a tie"
        );
        // Written in the folder layout, one file per conversation.
        stores.flush_all();
        let chat_dir = data.join(own("chat-history").trim_end_matches(".json"));
        assert!(chat_dir.join("a.json").is_file());
        assert_eq!(stores.clipboard.snapshot().0[0]["text"], "copied in Levis");

        let read = |p: &Path| std::fs::read_to_string(p).unwrap();
        assert_eq!(read(&config.join("themes/ink/light.css")), "body{}");
        assert_eq!(
            read(&config.join("agent/agent.md")),
            "Write in British English."
        );
        assert!(config.join("agent/skills/house.md").is_file());
        assert_eq!(
            read_json(&config.join("recent_files.json")).unwrap(),
            json!(["/docs/both.md", "/docs/textus.md", "/docs/levis.md"])
        );
        assert!(config.join("session.json").is_file());
        assert!(config.join("prefs.json").is_file());
        assert!(data.join("drafts/tab-1.json").is_file());
        assert!(data.join("assets/shot.png").is_file());
        assert_eq!(
            read_json(&config.join("provider_keys.json")).unwrap(),
            json!({"openai": "textus-openai", "anthropic": "levis-key"})
        );
        assert!(config.join("auth-codex.json").is_file());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            for f in ["provider_keys.json", "auth-codex.json"] {
                let mode = std::fs::metadata(config.join(f))
                    .unwrap()
                    .permissions()
                    .mode();
                assert_eq!(mode & 0o777, 0o600, "{f}");
            }
        }

        // Running it again changes nothing and copies nothing twice.
        let again = import(&levis, &config, &data, &stores, true);
        assert!(again.kept.contains(&"session.json".to_string()));
        assert_eq!(stores.chat.list().as_array().unwrap().len(), 2);
        assert_eq!(snapshot(&root.join("levis-config")), before);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn credentials_stay_behind_without_consent() {
        let root = scratch("no-creds");
        let levis = Dirs {
            config: root.join("levis-config"),
            data: root.join("levis-data"),
        };
        let config = root.join("textus-config");
        let data = root.join("textus-data");
        write(
            &levis.config.join("settings.json"),
            r#"{"schemaVersion":1,"settings":{"theme":"dark"}}"#,
        );
        write(
            &levis.config.join("provider_keys.json"),
            r#"{"anthropic":"k"}"#,
        );
        write(&levis.config.join("auth-claude.json"), r#"{"token":"t"}"#);
        let stores = Stores::load(&config, &data);
        let report = import(&levis, &config, &data, &stores, false);
        assert_eq!(report.imported, [Item::Settings]);
        assert!(!config.join("provider_keys.json").exists());
        assert!(!config.join("auth-claude.json").exists());
        std::fs::remove_dir_all(&root).unwrap();
    }
}
