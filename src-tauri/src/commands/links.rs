//! Pages of ours the app opens in the system browser. Each URL is fixed
//! here rather than passed in, so the frontend can't send the browser
//! anywhere else.

const SITE: &str = "https://textus.catvinci.com";

/// The website's community page (Discord, and the QQ and WeChat groups) in
/// the UI's `language` (a code of LANGS in src/i18n/langs.ts). Without one,
/// /join picks the page from the browser's languages. The page, not an
/// invite, so a changed invite or a new week's WeChat code needs no app
/// update.
pub fn community_url(language: Option<&str>) -> String {
    let dir = match language {
        Some("en") => "",
        Some("zh") => "zh/",
        Some("zh-Hant") => "zh-hant/",
        Some("ja") => "ja/",
        Some("ko") => "ko/",
        Some("es") => "es/",
        Some("fr") => "fr/",
        Some("de") => "de/",
        Some("ru") => "ru/",
        Some("pt") => "pt/",
        _ => return format!("{SITE}/join"),
    };
    format!("{SITE}/{dir}community/")
}

pub fn open_community(app: &tauri::AppHandle, language: Option<&str>) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url(community_url(language), None::<&str>)
        .map_err(|e| e.to_string())
}

/// The app's source code, from Settings › About.
const GITHUB_URL: &str = "https://github.com/CatVinci-Studio/Textus";

#[tauri::command]
pub async fn open_github_page(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url(GITHUB_URL, None::<&str>)
        .map_err(|e| e.to_string())
}

/// Help > Join the Community, and its row in Settings.
#[tauri::command]
pub async fn open_community_page(
    app: tauri::AppHandle,
    language: Option<String>,
) -> Result<(), String> {
    open_community(&app, language.as_deref())
}

#[cfg(test)]
mod tests {
    use super::community_url;

    #[test]
    fn every_ui_language_has_its_community_page() {
        for ui in crate::ai::ui_language::UI_LANGUAGES {
            assert!(
                community_url(Some(ui.code)).ends_with("community/"),
                "{} has no community page",
                ui.code
            );
        }
        assert_eq!(
            community_url(Some("zh-Hant")),
            "https://textus.catvinci.com/zh-hant/community/"
        );
        assert_eq!(
            community_url(Some("en")),
            "https://textus.catvinci.com/community/"
        );
    }

    #[test]
    fn an_unknown_language_lets_the_site_choose() {
        assert_eq!(community_url(None), "https://textus.catvinci.com/join");
        assert_eq!(
            community_url(Some("../evil")),
            "https://textus.catvinci.com/join"
        );
    }
}
