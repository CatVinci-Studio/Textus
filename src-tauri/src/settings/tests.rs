
use super::*;
use std::sync::atomic::AtomicU32;

static DIR_COUNTER: AtomicU32 = AtomicU32::new(0);

/// A fresh, empty directory per test.
fn temp_dir() -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "textus-settings-test-{}-{}",
        std::process::id(),
        DIR_COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn obj(value: Value) -> Map<String, Value> {
    value.as_object().unwrap().clone()
}

fn read_file(path: &Path) -> Value {
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

fn settings_path(dir: &Path) -> PathBuf {
    dir.join(file_name("settings"))
}

#[test]
fn patches_merge_top_level_fields_and_bump_the_revision() {
    let dir = temp_dir();
    let stores = Stores::load(&dir, &dir);
    let rev0 = stores.settings.snapshot().1;
    let rev1 = stores.patch_settings(&obj(json!({ "theme": "dark" })));
    // A second window's patch of another field leaves the first alone.
    let rev2 = stores.patch_settings(&obj(json!({ "zoom": 1.2 })));
    assert!(rev0 < rev1 && rev1 < rev2);
    // A nested object is replaced whole, not deep-merged.
    stores.patch_settings(&obj(json!({ "shortcuts": { "a": "x", "b": "y" } })));
    stores.patch_settings(&obj(json!({ "shortcuts": { "a": "z" } })));
    // null removes a field.
    stores.patch_settings(&obj(json!({ "zoom": null })));
    assert_eq!(
        stores.settings.snapshot().0,
        json!({ "theme": "dark", "shortcuts": { "a": "z" } })
    );
}

#[test]
fn writes_are_debounced_and_flushed() {
    let dir = temp_dir();
    let stores = Stores::load(&dir, &dir);
    stores.patch_settings(&obj(json!({ "theme": "dark" })));
    // Not yet: the write waits out the debounce.
    assert!(!settings_path(&dir).exists());
    // Then it lands on its own. Wait for it rather than for a fixed time:
    // a busy CI runner can take well past the debounce to get there.
    let deadline = std::time::Instant::now() + Duration::from_secs(10);
    while !settings_path(&dir).exists() && std::time::Instant::now() < deadline {
        std::thread::sleep(FLUSH_DELAY / 5);
    }
    let file = read_file(&settings_path(&dir));
    assert_eq!(file["schemaVersion"], json!(SCHEMA_VERSION));
    assert_eq!(file["settings"], json!({ "theme": "dark" }));

    // An explicit flush (the exit path) writes immediately.
    stores.patch_settings(&obj(json!({ "theme": "light" })));
    stores.flush_all();
    assert_eq!(
        read_file(&settings_path(&dir))["settings"]["theme"],
        json!("light")
    );
    // ...and reloading reads back what was written, with no import.
    let reloaded = Stores::load(&dir, &dir);
    assert_eq!(reloaded.settings.snapshot().0["theme"], json!("light"));
    assert!(!reloaded.legacy_import_pending());
}

#[test]
fn legacy_import_is_accepted_once_and_keeps_newer_changes() {
    let dir = temp_dir();
    let stores = Stores::load(&dir, &dir);
    assert!(stores.legacy_import_pending());
    // A change made before the import arrives is newer than it.
    stores.patch_settings(&obj(json!({ "zoom": 1.5 })));
    let accepted = stores.import_legacy(LegacyPayload {
        settings: Some(obj(
            json!({ "theme": "dark", "zoom": 1.0, "language": "ja" }),
        )),
        ..Default::default()
    });
    assert!(accepted);
    assert_eq!(
        stores.settings.snapshot().0,
        json!({ "theme": "dark", "zoom": 1.5, "language": "ja" })
    );
    // The file exists right away, so the next launch won't import.
    assert!(settings_path(&dir).exists());
    // A second window restored at the same launch loses the race.
    let again = stores.import_legacy(LegacyPayload {
        settings: Some(obj(json!({ "theme": "light" }))),
        ..Default::default()
    });
    assert!(!again);
    assert_eq!(stores.settings.snapshot().0["theme"], json!("dark"));
    assert!(!Stores::load(&dir, &dir).legacy_import_pending());
}

#[test]
fn no_import_once_settings_json_exists() {
    let dir = temp_dir();
    std::fs::write(
        settings_path(&dir),
        r#"{"schemaVersion":1,"settings":{"theme":"dark"}}"#,
    )
    .unwrap();
    let stores = Stores::load(&dir, &dir);
    assert!(!stores.legacy_import_pending());
    assert!(!stores.import_legacy(LegacyPayload {
        settings: Some(obj(json!({ "theme": "light" }))),
        ..Default::default()
    }));
    assert_eq!(stores.settings.snapshot().0["theme"], json!("dark"));
}

#[test]
fn import_brings_histories_and_ui_state() {
    let dir = temp_dir();
    let stores = Stores::load(&dir, &dir);
    stores
        .clipboard
        .upsert(HistoryKind::Clipboard, json!({ "text": "new", "at": 3 }));
    stores.import_legacy(LegacyPayload {
        settings: Some(Map::new()),
        ui_state: Some(obj(json!({ "agentPanelOpen": true }))),
        chat_history: Some(vec![
            json!({ "id": "a", "updatedAt": 1, "turns": [] }),
            json!({ "id": "b", "updatedAt": 2, "turns": [] }),
            json!({ "id": "broken" }),
        ]),
        clipboard_history: Some(vec![
            json!({ "text": "new", "at": 1 }),
            json!({ "text": "old", "at": 1 }),
        ]),
    });
    let ids: Vec<_> = stores
        .chat
        .list()
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["id"].as_str().unwrap().to_owned())
        .collect();
    assert_eq!(ids, ["b", "a"]);
    assert_eq!(
        stores.clipboard.snapshot().0,
        json!([{ "text": "new", "at": 3 }, { "text": "old", "at": 1 }])
    );
    assert_eq!(
        stores.ui_state.snapshot().0,
        json!({ "agentPanelOpen": true })
    );
}

#[test]
fn prefs_json_seeds_the_first_launch() {
    let dir = temp_dir();
    std::fs::write(
            dir.join("prefs.json"),
            r#"{"new_document_mode":"tab","restore_session_on_startup":false,"editor_window_size":[900,700]}"#,
        )
        .unwrap();
    let stores = Stores::load(&dir, &dir);
    let settings = stores.settings.snapshot().0;
    assert_eq!(settings["newDocumentMode"], json!("tab"));
    assert_eq!(settings["restoreSessionOnStartup"], json!(false));
    // An import without the fields (a blob from before they existed)
    // keeps what prefs.json said; one with them wins.
    stores.import_legacy(LegacyPayload {
        settings: Some(obj(json!({ "newDocumentMode": "window" }))),
        ..Default::default()
    });
    let settings = stores.settings.snapshot().0;
    assert_eq!(settings["newDocumentMode"], json!("window"));
    assert_eq!(settings["restoreSessionOnStartup"], json!(false));
}

#[test]
fn corrupt_settings_are_moved_aside_and_defaults_used() {
    let dir = temp_dir();
    std::fs::write(settings_path(&dir), "{ not json").unwrap();
    let stores = Stores::load(&dir, &dir);
    assert_eq!(stores.settings.snapshot().0, json!({}));
    // Not a first launch: localStorage is months old by now.
    assert!(!stores.legacy_import_pending());
    assert!(!settings_path(&dir).exists());
    let aside: Vec<_> = std::fs::read_dir(&dir)
        .unwrap()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_name().to_string_lossy().contains(".corrupt-"))
        .collect();
    assert_eq!(aside.len(), 1);
    assert_eq!(
        std::fs::read_to_string(aside[0].path()).unwrap(),
        "{ not json"
    );

    // The wrong shape counts as corrupt too.
    let dir = temp_dir();
    std::fs::write(settings_path(&dir), r#"{"settings":[1,2]}"#).unwrap();
    assert_eq!(Stores::load(&dir, &dir).settings.snapshot().0, json!({}));
}

#[test]
fn a_settings_file_that_is_not_utf8_counts_as_corrupt() {
    let dir = temp_dir();
    std::fs::write(settings_path(&dir), [0xff, 0xfe, b'{']).unwrap();
    let stores = Stores::load(&dir, &dir);
    assert_eq!(stores.settings.snapshot().0, json!({}));
    assert!(!settings_path(&dir).exists());
    stores.patch_settings(&obj(json!({ "theme": "dark" })));
    stores.flush_all();
    assert_eq!(
        read_file(&settings_path(&dir))["settings"],
        json!({ "theme": "dark" })
    );
}

/// A settings.json that's there but can't be read (here: no read
/// permission) is left exactly as it is - never replaced by this
/// session's defaults - while the app runs on in-memory settings.
#[cfg(unix)]
#[test]
fn an_unreadable_settings_file_is_never_overwritten() {
    use std::os::unix::fs::PermissionsExt;
    let dir = temp_dir();
    let path = settings_path(&dir);
    let original = r#"{"schemaVersion":1,"settings":{"theme":"dark"}}"#;
    std::fs::write(&path, original).unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o000)).unwrap();
    if std::fs::read_to_string(&path).is_ok() {
        // Running as root: permissions don't stop reads, nothing to test.
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
        return;
    }
    let stores = Stores::load(&dir, &dir);
    assert_eq!(stores.settings.snapshot().0, json!({}));
    // Not a first launch either: no import over the real data.
    assert!(!stores.legacy_import_pending());
    // The frontend writes its defaults, the user changes something...
    stores.fill_missing_settings(&obj(json!({ "theme": "system", "zoom": 1 })));
    stores.patch_settings(&obj(json!({ "zoom": 1.5 })));
    // ...and it all works, in memory,
    assert_eq!(
        stores.settings.snapshot().0,
        json!({ "theme": "system", "zoom": 1.5 })
    );
    // without a write, debounced or on exit.
    std::thread::sleep(FLUSH_DELAY * 3);
    stores.flush_all();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
    assert_eq!(std::fs::read_to_string(&path).unwrap(), original);
    let names: Vec<_> = std::fs::read_dir(&dir)
        .unwrap()
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(names, [file_name("settings")], "nothing moved aside");
}

#[test]
fn filling_defaults_never_overwrites_a_set_field() {
    let dir = temp_dir();
    std::fs::write(settings_path(&dir), "{ not json").unwrap();
    // Launch after the corrupt file was moved aside: nothing stored.
    let stores = Stores::load(&dir, &dir);
    let defaults = obj(json!({ "theme": "system", "zoom": 1, "language": "en" }));
    let (added, rev) = stores.fill_missing_settings(&defaults).unwrap();
    assert_eq!(added, defaults);
    // The user changes things...
    let changed = stores.patch_settings(&obj(json!({ "theme": "dark", "zoom": null })));
    assert!(changed > rev);
    // ...and a reloaded window, replaying its empty boot snapshot, offers
    // the same defaults again: only the field that's missing comes back.
    let (added, _) = stores.fill_missing_settings(&defaults).unwrap();
    assert_eq!(added, obj(json!({ "zoom": 1 })));
    assert_eq!(
        stores.settings.snapshot().0,
        json!({ "theme": "dark", "zoom": 1, "language": "en" })
    );
    // Nothing missing: no change, no new revision.
    let rev = stores.settings.snapshot().1;
    assert!(stores.fill_missing_settings(&defaults).is_none());
    assert_eq!(stores.settings.snapshot().1, rev);
    stores.flush_all();
    assert_eq!(
        read_file(&settings_path(&dir))["settings"]["theme"],
        json!("dark")
    );
}

#[test]
fn schema_version_is_written_and_a_newer_one_kept() {
    let dir = temp_dir();
    std::fs::write(
        settings_path(&dir),
        r#"{"schemaVersion":7,"settings":{"theme":"dark","fromTheFuture":true}}"#,
    )
    .unwrap();
    let stores = Stores::load(&dir, &dir);
    stores.patch_settings(&obj(json!({ "theme": "light" })));
    stores.flush_all();
    let file = read_file(&settings_path(&dir));
    assert_eq!(file["schemaVersion"], json!(7));
    assert_eq!(
        file["settings"],
        json!({ "theme": "light", "fromTheFuture": true })
    );
}

#[test]
fn only_a_pinned_appearance_overrides_the_system() {
    assert_eq!(
        app_theme(&json!({ "theme": "dark" })),
        Some(tauri::Theme::Dark)
    );
    assert_eq!(
        app_theme(&json!({ "theme": "light" })),
        Some(tauri::Theme::Light)
    );
    assert_eq!(app_theme(&json!({ "theme": "system" })), None);
    assert_eq!(app_theme(&json!({})), None);
    assert_eq!(app_theme(&json!({ "theme": 42 })), None);
}

#[test]
fn a_pinned_appearance_gives_windows_the_page_background() {
    // Checked against the page itself, not restated here: a window must
    // open in exactly the colour index.html paints first and ui/base.css's
    // --bg keeps, or the change is a flash of its own. A failure here
    // means one of the three moved without the others.
    let index = include_str!("../../../index.html");
    let app_css = include_str!("../../../src/ui/base.css");
    for (theme, app_css_rule) in [
        ("dark", ":root[data-theme=\"dark\"] {"),
        ("light", ":root {"),
    ] {
        let Some(tauri::window::Color(r, g, b, a)) = pinned_background(&json!({ "theme": theme }))
        else {
            panic!("no window background for a pinned {theme}");
        };
        let hex = format!("#{r:02x}{g:02x}{b:02x}");
        assert_eq!(a, 0xff, "{theme}: an opaque window");
        let index_rule = format!("html[data-theme=\"{theme}\"] {{");
        assert_eq!(
            css_value(index, &index_rule, "background:"),
            hex,
            "index.html, {theme}"
        );
        assert_eq!(
            css_value(app_css, app_css_rule, "--bg:"),
            hex,
            "ui/base.css, {theme}"
        );
    }
    // "system", missing or unreadable: the toolkit's own default.
    assert_eq!(pinned_background(&json!({ "theme": "system" })), None);
    assert_eq!(pinned_background(&json!({})), None);
    assert_eq!(pinned_background(&json!({ "theme": 1 })), None);
}

/// The value `property` has in the first rule that starts with `rule`.
fn css_value<'a>(css: &'a str, rule: &str, property: &str) -> &'a str {
    let start = css.find(rule).unwrap_or_else(|| panic!("no `{rule}` rule"));
    let body = &css[start + rule.len()..];
    let body = &body[..body.find('}').expect("an unclosed rule")];
    let at = body
        .find(property)
        .unwrap_or_else(|| panic!("no `{property}` in `{rule}`"));
    body[at + property.len()..]
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
}

#[test]
fn histories_upsert_dedupe_sort_and_cap() {
    let dir = temp_dir();
    let stores = Stores::load(&dir, &dir);
    let chat = &stores.chat;
    for i in 0..70 {
        chat.save(json!({ "id": format!("c{i}"), "updatedAt": i, "turns": [] }));
    }
    // Re-saving a conversation moves it, never duplicates it.
    chat.save(json!({ "id": "c30", "updatedAt": 100, "turns": [1] }));
    let list = chat.list();
    let list = list.as_array().unwrap();
    assert_eq!(list.len(), 70);
    assert_eq!(list[0]["id"], json!("c30"));
    assert_eq!(list[1]["id"], json!("c69"));
    assert_eq!(list.iter().filter(|e| e["id"] == json!("c30")).count(), 1);

    chat.remove("c30");
    assert_eq!(chat.list()[0]["id"], json!("c69"));

    let clip = &stores.clipboard;
    for i in 0..35 {
        clip.upsert(
            HistoryKind::Clipboard,
            json!({ "text": format!("t{i}"), "at": i }),
        );
    }
    clip.upsert(HistoryKind::Clipboard, json!({ "text": "t10", "at": 99 }));
    let list = clip.snapshot().0;
    assert_eq!(list.as_array().unwrap().len(), 30);
    assert_eq!(list[0]["text"], json!("t10"));
    clip.clear();
    stores.flush_all();
    assert_eq!(
        read_file(&dir.join(file_name("clipboard-history")))["entries"],
        json!([])
    );
}

#[test]
fn invalid_history_entries_are_rejected() {
    assert!(!HistoryKind::Chat.valid(&json!({ "id": "x" })));
    assert!(!HistoryKind::Clipboard.valid(&json!({ "text": 1, "at": 1 })));
    let long = "x".repeat(MAX_CLIPBOARD_TEXT + 1);
    assert!(!HistoryKind::Clipboard.valid(&json!({ "text": long, "at": 1 })));
    assert!(HistoryKind::Clipboard.valid(&json!({ "text": "ok", "at": 1 })));
}
