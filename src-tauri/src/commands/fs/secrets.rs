//! The app's own key files, kept out of the page's file commands.

use crate::app_dirs::AppDirs;
use std::path::Path;

/// The files the app keeps keys and sign-ins in: never read or written
/// through the page's file commands.
const SECRET_FILES: [&str; 5] = [
    crate::auth::keys::FILE,
    crate::auth::claude::FILE,
    crate::auth::openai_codex::FILE,
    crate::auth::custom_endpoint::FILE,
    crate::plugins::files::SECRETS_FILE,
];

/// Where the app keeps its config, keys among it, as a canonical path.
pub(super) fn own_config_dir(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    use tauri::Manager;
    let dir = app.path().own_config_dir().ok()?;
    std::fs::canonicalize(dir).ok()
}

pub(super) fn not_a_secret(app: &tauri::AppHandle, path: &str) -> Result<(), String> {
    let Some(config) = own_config_dir(app) else {
        return Ok(());
    };
    // Where it really is (a link elsewhere may lead here), named in any case
    // (macOS and Windows don't tell them apart), set-aside copies included.
    let path = Path::new(path);
    let real = std::fs::canonicalize(path).ok().or_else(|| {
        let dir = std::fs::canonicalize(path.parent()?).ok()?;
        Some(dir.join(path.file_name()?))
    });
    let secret = real.is_some_and(|real| {
        let name = real
            .file_name()
            .map(|n| n.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        real.parent() == Some(config.as_path())
            && SECRET_FILES
                .iter()
                .any(|s| name == *s || name.starts_with(&format!("{s}.")))
    });
    if secret {
        return Err(crate::errors::error("secretsFile"));
    }
    Ok(())
}
