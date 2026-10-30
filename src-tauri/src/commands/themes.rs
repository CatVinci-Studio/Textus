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
    // Settings still list it: the window drops it after this returns.
    let user_themes = crate::settings::read_setting(&app, "userThemes");
    if let Some((gallery_id, version)) = user_themes.and_then(|t| gallery_origin(&t, &id)) {
        let theme = crate::ext_stats::Kind::Theme;
        crate::ext_stats::uninstalled(&app, theme, &gallery_id, &version);
    }
    Ok(())
}

/// The gallery theme user theme `id` was installed from, and its version
/// (`updated`), from the settings' `userThemes` (UserThemeMeta in
/// src/prefs/settings-types.ts).
fn gallery_origin(user_themes: &serde_json::Value, id: &str) -> Option<(String, String)> {
    let gallery = user_themes
        .as_array()?
        .iter()
        .find(|t| t.get("id").and_then(|v| v.as_str()) == Some(id))?
        .get("gallery")?;
    let field = |key| Some(gallery.get(key)?.as_str()?.to_string());
    Some((field("id")?, field("updated")?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_theme_from_the_gallery_has_an_origin() {
        let themes = serde_json::json!([
            {"id": "mine", "name": "Mine", "hasDark": false},
            {"id": "u-1", "name": "Plain", "hasDark": true,
             "gallery": {"id": "plain", "updated": "2026-10-18T04:55:06Z", "source": ""}}
        ]);
        assert_eq!(
            gallery_origin(&themes, "u-1"),
            Some(("plain".into(), "2026-10-18T04:55:06Z".into()))
        );
        assert_eq!(gallery_origin(&themes, "mine"), None);
        assert_eq!(gallery_origin(&themes, "gone"), None);
        assert_eq!(gallery_origin(&serde_json::Value::Null, "u-1"), None);
    }
}
