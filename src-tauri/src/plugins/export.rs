//! Export for publishing: a plugin you made, copied into a folder ready to be a
//! GitHub repository, its id under your name (`local.word-count` ->
//! `jane.word-count`), with a README, MIT LICENSE, .gitignore and release workflow.

use std::path::{Path, PathBuf};

use super::{access::plugin_home, require_id, state};

const README: &str = include_str!("template/README.md");
const LICENSE: &str = include_str!("template/LICENSE");
const GITIGNORE: &str = include_str!("template/gitignore");
const RELEASE: &str = include_str!("template/release.yml");

/// A publisher's name, as in a plugin id: lowercase letters, digits and
/// single dashes.
fn valid_publisher(name: &str) -> bool {
    !name.is_empty()
        && name.split('-').all(|part| {
            !part.is_empty()
                && part
                    .chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
        })
}

/// This year, near enough for a copyright line.
fn this_year() -> u64 {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    1970 + secs / 31_556_952
}

/// Every file under `from` but hidden ones, copied to `to`.
fn copy_files(from: &Path, to: &Path) -> Result<(), String> {
    std::fs::create_dir_all(to).map_err(|e| e.to_string())?;
    for entry in std::fs::read_dir(from).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name();
        if name.to_string_lossy().starts_with('.') {
            continue;
        }
        let path = entry.path();
        let kind = entry.file_type().map_err(|e| e.to_string())?;
        if kind.is_dir() {
            copy_files(&path, &to.join(&name))?;
        } else if kind.is_file() {
            std::fs::copy(&path, to.join(&name)).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Writes `text` at `path` unless the plugin brought its own.
fn write_new(path: &Path, text: &str) -> Result<(), String> {
    if path.exists() {
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(path, text).map_err(|e| e.to_string())
}

/// Lays out the plugin at `source` for publishing in `folder` as `publisher`'s;
/// returns the new folder's path.
pub(crate) fn export_to(source: &Path, publisher: &str, folder: &Path) -> Result<PathBuf, String> {
    if !valid_publisher(publisher) {
        return Err(format!(
            "\"{publisher}\" can't be a publisher's name: use lowercase letters, digits and dashes."
        ));
    }
    let text = std::fs::read_to_string(source.join("textus-plugin.json"))
        .map_err(|e| format!("The plugin has no textus-plugin.json: {e}"))?;
    let mut manifest: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    let id = manifest["id"].as_str().unwrap_or_default().to_string();
    let (_, name) = id
        .split_once('.')
        .ok_or_else(|| format!("{id} is not a plugin id."))?;
    let new_id = format!("{publisher}.{name}");
    let target = folder.join(&new_id);
    if target.exists() {
        return Err(format!("{} is already there.", target.display()));
    }
    copy_files(source, &target)?;
    manifest["id"] = new_id.clone().into();
    manifest["publisher"] = publisher.into();
    let pretty = serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?;
    std::fs::write(target.join("textus-plugin.json"), pretty + "\n").map_err(|e| e.to_string())?;
    // A "%key%" value is a string of its l10n, in English.
    let field = |key: &str| {
        let value = manifest[key].as_str().unwrap_or_default();
        value
            .strip_prefix('%')
            .and_then(|v| v.strip_suffix('%'))
            .and_then(|k| manifest["l10n"]["en"][k].as_str())
            .unwrap_or(value)
            .to_string()
    };
    write_new(
        &target.join("README.md"),
        &README
            .replace("{name}", &field("name"))
            .replace("{description}", &field("description"))
            .replace("{id}", &new_id),
    )?;
    write_new(
        &target.join("LICENSE"),
        &LICENSE
            .replace("{year}", &this_year().to_string())
            .replace("{publisher}", publisher),
    )?;
    write_new(&target.join(".gitignore"), GITIGNORE)?;
    write_new(&target.join(".github/workflows/release.yml"), RELEASE)?;
    Ok(target)
}

/// Export for publishing: plugin `id` laid out in `folder` as `publisher`'s.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn plugin_export(
    app: tauri::AppHandle,
    id: String,
    publisher: String,
    folder: String,
) -> Result<String, String> {
    require_id(&id)?;
    let source = plugin_home(&app, &state::read(&app), &id)?;
    export_to(&source, &publisher, Path::new(&folder)).map(|p| p.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plugin(dir: &Path) {
        std::fs::create_dir_all(dir.join("lib")).unwrap();
        std::fs::write(
            dir.join("textus-plugin.json"),
            r#"{"id":"local.word-count","name":"%name%","publisher":"local","description":"Counts.","version":"0.1.0","l10n":{"en":{"name":"Word Count"}}}"#,
        )
        .unwrap();
        std::fs::write(dir.join("host.js"), "exports.activate = () => {};").unwrap();
        std::fs::write(dir.join("lib/x.js"), "1").unwrap();
        std::fs::write(dir.join(".DS_Store"), "junk").unwrap();
    }

    #[test]
    fn lays_a_plugin_out_as_its_publishers() {
        let tmp = tempfile::tempdir().unwrap();
        let source = tmp.path().join("src");
        plugin(&source);
        let out = tmp.path().join("out");
        let target = export_to(&source, "jane", &out).unwrap();
        assert_eq!(target, out.join("jane.word-count"));
        let manifest: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(target.join("textus-plugin.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(manifest["id"], "jane.word-count");
        assert_eq!(manifest["publisher"], "jane");
        assert!(target.join("host.js").is_file());
        assert!(target.join("lib/x.js").is_file());
        assert!(!target.join(".DS_Store").exists());
        let readme = std::fs::read_to_string(target.join("README.md")).unwrap();
        assert!(readme.starts_with("# Word Count\n\nCounts."));
        assert!(readme.contains("jane.word-count-<version>.zip"));
        assert!(std::fs::read_to_string(target.join("LICENSE"))
            .unwrap()
            .contains(" jane\n"));
        assert!(target.join(".github/workflows/release.yml").is_file());
        assert!(target.join(".gitignore").is_file());
        // Not over a folder already there.
        assert!(export_to(&source, "jane", &out).is_err());
    }

    #[test]
    fn refuses_a_name_that_cant_be_a_publisher() {
        let tmp = tempfile::tempdir().unwrap();
        let source = tmp.path().join("src");
        plugin(&source);
        for bad in ["", "Jane", "jane doe", "-jane", "jane--doe", "jane.doe"] {
            assert!(export_to(&source, bad, tmp.path()).is_err(), "{bad}");
        }
    }
}
