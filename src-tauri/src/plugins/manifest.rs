//! The checks on `textus-plugin.json` that decide what a plugin may ask for:
//! its id and version, who made it, the permissions it names, where it runs.
//! Every way a plugin is installed or loaded passes through here, so a window
//! that skipped its own check still can't install a manifest asking for a
//! permission Textus doesn't have.
//!
//! Mirrors `parseManifest` in `src/plugins/store/manifest.ts`; change both.
//! What a plugin adds to the interface (`contributes`) is left to the window,
//! which checks it before drawing any of it.

use super::require_id;
use serde_json::{Map, Value};

/// Permissions without a host. `network:<host>` is checked apart.
const PLAIN_PERMISSIONS: &[&str] = &[
    "editor.read",
    "editor.write",
    "editor.propose",
    "files.read",
    "files.write",
    "clipboard",
    "editor.input",
    "project.data",
    "ai.tools",
    "notifications",
    "background",
    "agents",
];

const REQUIRED_SETTINGS: &[&str] = &["runInBackground"];
const PLATFORMS: &[&str] = &["desktop", "ios"];

/// Whether `value` is a permission a plugin may name: one of the plain ones,
/// or `network:` and `*`, a host, `*.` a domain, each maybe with `:port`.
pub fn is_permission(value: &str) -> bool {
    if PLAIN_PERMISSIONS.contains(&value) {
        return true;
    }
    let Some(host) = value.strip_prefix("network:") else {
        return false;
    };
    if host == "*" {
        return true;
    }
    let host = host.strip_prefix("*.").unwrap_or(host);
    let (name, port) = match host.split_once(':') {
        Some((name, port)) => (name, Some(port)),
        None => (host, None),
    };
    !name.is_empty()
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
        && port.is_none_or(|p| (1..=5).contains(&p.len()) && p.chars().all(|c| c.is_ascii_digit()))
}

/// `1.0.0`, maybe with a pre-release: `1.0.0-beta.1`.
fn is_version(value: &str) -> bool {
    let (core, pre) = match value.split_once('-') {
        Some((core, pre)) => (core, Some(pre)),
        None => (value, None),
    };
    let parts: Vec<&str> = core.split('.').collect();
    parts.len() == 3
        && parts
            .iter()
            .all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()))
        && pre.is_none_or(|p| {
            !p.is_empty()
                && p.chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
        })
}

fn object<'a>(value: &'a Value, what: &str) -> Result<&'a Map<String, Value>, String> {
    value
        .as_object()
        .ok_or_else(|| format!("{what} must be an object."))
}

/// A list, or none at all.
fn list<'a>(value: Option<&'a Value>, what: &str) -> Result<&'a [Value], String> {
    match value {
        None => Ok(&[]),
        Some(Value::Array(items)) => Ok(items),
        Some(_) => Err(format!("{what} must be a list.")),
    }
}

/// A string with something in it.
fn text<'a>(value: Option<&'a Value>, what: &str) -> Result<&'a str, String> {
    match value.and_then(Value::as_str) {
        Some(s) if !s.trim().is_empty() => Ok(s),
        _ => Err(format!("{what} must be a string.")),
    }
}

/// Like `text`, but it may be left out.
fn optional_text<'a>(value: Option<&'a Value>, what: &str) -> Result<Option<&'a str>, String> {
    value.map(|v| text(Some(v), what)).transpose()
}

/// The permissions `manifest` names that Textus has; none when it can't be read.
pub fn declared_permissions(manifest: &str) -> Vec<String> {
    serde_json::from_str::<Value>(manifest)
        .ok()
        .and_then(|m| m.get("permissions")?.as_array().cloned())
        .unwrap_or_default()
        .iter()
        .filter_map(Value::as_str)
        .filter(|p| is_permission(p))
        .map(str::to_string)
        .collect()
}

/// `text` (the manifest as written), checked; the error says what is wrong,
/// in English, for the plugin's author.
pub fn check(manifest: &str) -> Result<(), String> {
    let json: Value = serde_json::from_str(manifest)
        .map_err(|e| format!("textus-plugin.json is not JSON: {e}"))?;
    let m = object(&json, "textus-plugin.json")?;

    let id = text(m.get("id"), "id")?;
    require_id(id).map_err(|_| format!("id \"{id}\" must be publisher.name, lowercase."))?;
    let version = text(m.get("version"), "version")?;
    if !is_version(version) {
        return Err(format!("version \"{version}\" must be like 1.0.0."));
    }
    text(m.get("name"), "name")?;
    text(m.get("publisher"), "publisher")?;
    for field in ["author", "description", "icon", "license", "repository"] {
        optional_text(m.get(field), field)?;
    }
    let empty = Value::Object(Map::new());
    let engines = object(m.get("engines").unwrap_or(&empty), "engines")?;
    text(engines.get("textus"), "engines.textus")?;

    for p in list(m.get("permissions"), "permissions")? {
        if !p.as_str().is_some_and(is_permission) {
            return Err(format!("No permission {p}."));
        }
    }

    let background = optional_text(m.get("background"), "background")?;
    let mut in_background = background.is_some();
    for (i, r) in list(m.get("requires"), "requires")?.iter().enumerate() {
        let need = object(r, &format!("requires[{i}]"))?;
        let setting = text(need.get("setting"), &format!("requires[{i}].setting"))?;
        if !REQUIRED_SETTINGS.contains(&setting) {
            return Err(format!(
                "requires[{i}].setting \"{setting}\" is not one of {}.",
                REQUIRED_SETTINGS.join(", ")
            ));
        }
        optional_text(need.get("reason"), &format!("requires[{i}].reason"))?;
        in_background |= setting == "runInBackground";
    }
    if m.get("platforms").is_some() {
        let platforms = list(m.get("platforms"), "platforms")?;
        for p in platforms {
            if !p.as_str().is_some_and(|p| PLATFORMS.contains(&p)) {
                return Err(format!("No platform {p}: desktop or ios."));
            }
        }
        if in_background && platforms.iter().any(|p| p == "ios") {
            return Err(
                "The background is the desktop's only: platforms can't name ios.".to_string(),
            );
        }
    }

    // One file, or several run in order.
    match m.get("main") {
        Some(file @ Value::String(_)) => {
            text(Some(file), "main[0]")?;
        }
        main => {
            for (i, f) in list(main, "main")?.iter().enumerate() {
                text(Some(f), &format!("main[{i}]"))?;
            }
        }
    }
    for (i, e) in list(m.get("activationEvents"), "activationEvents")?
        .iter()
        .enumerate()
    {
        text(Some(e), &format!("activationEvents[{i}]"))?;
    }
    if let Some(l10n) = m.get("l10n") {
        for (lang, table) in object(l10n, "l10n")? {
            object(table, &format!("l10n.{lang}"))?;
        }
    }
    if let Some(contributes) = m.get("contributes") {
        let contributes = object(contributes, "contributes")?;
        let embeds = contributes
            .get("embeds")
            .and_then(Value::as_array)
            .is_some_and(|e| !e.is_empty());
        let reads = list(m.get("permissions"), "permissions")?
            .iter()
            .any(|p| p.as_str() == Some("files.read"));
        if embeds && !reads {
            return Err("contributes.embeds needs files.read.".into());
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const GOOD: &str = r#"{"id":"a.b","name":"A","version":"1.0.0","publisher":"a",
        "engines":{"textus":"^1.3.0"}}"#;

    /// `GOOD` with `field` set to `value` (JSON), or removed when it's `None`.
    fn with(field: &str, value: Option<&str>) -> String {
        let mut m: Value = serde_json::from_str(GOOD).unwrap();
        let o = m.as_object_mut().unwrap();
        match value {
            Some(v) => o.insert(field.into(), serde_json::from_str(v).unwrap()),
            None => o.remove(field),
        };
        m.to_string()
    }

    #[test]
    fn a_complete_manifest_is_accepted() {
        assert!(check(GOOD).is_ok());
        assert!(check(&with(
            "permissions",
            Some(r#"["files.read","network:*.zotero.org:443"]"#)
        ))
        .is_ok());
        assert!(check(&with("main", Some(r#""dist/host.js""#))).is_ok());
        assert!(check(&with("main", Some(r#"["a.js","b.js"]"#))).is_ok());
        assert!(check(&with("version", Some(r#""2.0.0-beta.1""#))).is_ok());
    }

    #[test]
    fn a_manifest_missing_what_it_must_name_is_refused() {
        for field in ["id", "version", "name", "publisher", "engines"] {
            assert!(check(&with(field, None)).is_err(), "{field}");
        }
        assert!(check("[]").is_err());
        assert!(check("not json").is_err());
        assert!(check(&with("description", Some(r#""""#))).is_err());
    }

    #[test]
    fn ids_and_versions_keep_their_shape() {
        for id in [r#""A.b""#, r#""ab""#, r#""../x.y""#, r#""-a.b""#] {
            assert!(check(&with("id", Some(id))).is_err(), "{id}");
        }
        for v in [
            r#""1.0""#,
            r#""1.0.0.0""#,
            r#""v1.0.0""#,
            r#""1.0.0-""#,
            r#""1.0.0-a b""#,
        ] {
            assert!(check(&with("version", Some(v))).is_err(), "{v}");
        }
    }

    #[test]
    fn embeds_need_files_read() {
        let embeds = |permissions: &str| {
            let mut m: Value = serde_json::from_str(GOOD).unwrap();
            let o = m.as_object_mut().unwrap();
            o.insert(
                "contributes".into(),
                serde_json::json!({"embeds": [{"kind": "x"}]}),
            );
            o.insert(
                "permissions".into(),
                serde_json::from_str(permissions).unwrap(),
            );
            check(&m.to_string())
        };
        assert_eq!(
            embeds("[]").unwrap_err(),
            "contributes.embeds needs files.read."
        );
        assert!(embeds(r#"["files.read"]"#).is_ok());
    }

    #[test]
    fn only_permissions_textus_has_can_be_asked_for() {
        for p in [
            "files.read",
            "background",
            "network:*",
            "network:api.x.org",
            "network:*.x.org",
            "network:localhost:8080",
        ] {
            assert!(is_permission(p), "{p}");
        }
        for p in [
            "root",
            "files.*",
            "network:",
            "network:x.org/path",
            "network:x.org:",
            "network:x.org:123456",
            "network:**.x.org",
        ] {
            assert!(!is_permission(p), "{p}");
        }
        assert!(check(&with("permissions", Some(r#"["shell"]"#))).is_err());
        assert!(check(&with("permissions", Some(r#"[1]"#))).is_err());
        assert!(check(&with("permissions", Some(r#""files.read""#))).is_err());
    }

    #[test]
    fn background_work_stays_on_the_desktop() {
        assert!(check(&with("platforms", Some(r#"["desktop","ios"]"#))).is_ok());
        assert!(check(&with("platforms", Some(r#"["android"]"#))).is_err());
        let background = with("background", Some(r#""jobs.js""#));
        assert!(check(&background).is_ok());
        let mut m: Value = serde_json::from_str(&background).unwrap();
        m["platforms"] = serde_json::json!(["ios"]);
        assert!(check(&m.to_string()).is_err());
        let mut m: Value = serde_json::from_str(GOOD).unwrap();
        m["requires"] = serde_json::json!([{ "setting": "runInBackground" }]);
        m["platforms"] = serde_json::json!(["desktop", "ios"]);
        assert!(check(&m.to_string()).is_err());
        assert!(check(&with("requires", Some(r#"[{"setting":"sudo"}]"#))).is_err());
    }
}
