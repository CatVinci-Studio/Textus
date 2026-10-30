use tauri::{AppHandle, Manager};
use tokio::fs;

/// Where imported theme CSS lives: one subfolder per theme id, with `light.css`
/// and optionally `dark.css`, already self-contained.
fn themes_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_config_dir()
        .map_err(|e| e.to_string())
        .map(|p| p.join("themes"))
}

/// Theme ids become path components, so only alphanumerics, `-` and `_` pass.
fn valid_component(s: &str) -> bool {
    !s.is_empty()
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn variant_filename(variant: &str) -> Result<&'static str, String> {
    match variant {
        "light" => Ok("light.css"),
        "dark" => Ok("dark.css"),
        _ => Err(format!("invalid theme variant: {variant}")),
    }
}

#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn save_theme_css(
    app: AppHandle,
    id: String,
    variant: String,
    css: String,
) -> Result<(), String> {
    if !valid_component(&id) {
        return Err("invalid theme id".to_string());
    }
    let filename = variant_filename(&variant)?;
    let dir = themes_dir(&app)?.join(&id);
    fs::create_dir_all(&dir).await.map_err(|e| e.to_string())?;
    crate::atomic::write(&dir.join(filename), css)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn load_theme_css(
    app: AppHandle,
    id: String,
    variant: String,
) -> Result<Option<String>, String> {
    if !valid_component(&id) {
        return Err("invalid theme id".to_string());
    }
    let filename = variant_filename(&variant)?;
    let path = themes_dir(&app)?.join(&id).join(filename);
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(&path)
        .await
        .map(Some)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn delete_theme(app: AppHandle, id: String) -> Result<(), String> {
    if !valid_component(&id) {
        return Err("invalid theme id".to_string());
    }
    let dir = themes_dir(&app)?.join(&id);
    if dir.exists() {
        fs::remove_dir_all(&dir).await.map_err(|e| e.to_string())?;
    }
    Ok(())
}
