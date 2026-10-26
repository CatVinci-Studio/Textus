//! Pages the app opens in the system browser. Each URL is fixed here, so the
//! frontend can't send the browser elsewhere; document links are held to web and mail.

const SITE: &str = "https://textus.catvinci.com";

/// The website's community page in the UI's `language`; without one, /join
/// picks by the browser's languages. The page, not an invite, so changes need no update.
pub fn community_url(language: Option<&str>) -> String {
    match language.and_then(language_dir) {
        Some(dir) => format!("{SITE}/{dir}community/"),
        None => format!("{SITE}/join"),
    }
}

/// The website's folder for a UI language: "" for English, served at the root.
fn language_dir(language: &str) -> Option<&'static str> {
    Some(match language {
        "en" => "",
        "zh" => "zh/",
        "zh-Hant" => "zh-hant/",
        "ja" => "ja/",
        "ko" => "ko/",
        "es" => "es/",
        "fr" => "fr/",
        "de" => "de/",
        "ru" => "ru/",
        "pt" => "pt/",
        _ => return None,
    })
}

/// The clips on the website's tutorials page, each an element id there. Keep
/// in step with TUTORIAL_CLIPS in tutorial-steps.ts.
const TUTORIAL_CLIPS: &[&str] = &[
    "wysiwyg",
    "blocks",
    "modes-themes",
    "sidebar-export",
    "ai-panel",
    "continuation",
    "grammar",
    "revision",
    "review",
    "skills",
    "memory",
];

/// The website's video tutorials in the UI's `language` (English by default),
/// at `clip` when named. None for a clip the page doesn't have.
pub fn tutorials_url(clip: Option<&str>, language: Option<&str>) -> Option<String> {
    let dir = language.and_then(language_dir).unwrap_or("");
    let page = format!("{SITE}/{dir}tutorials/");
    match clip {
        None => Some(page),
        Some(clip) => TUTORIAL_CLIPS
            .contains(&clip)
            .then(|| format!("{page}#{clip}")),
    }
}

pub fn open_tutorials(
    app: &tauri::AppHandle,
    clip: Option<&str>,
    language: Option<&str>,
) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let url = tutorials_url(clip, language).ok_or_else(|| "no such tutorial".to_string())?;
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}

pub fn open_community(app: &tauri::AppHandle, language: Option<&str>) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url(community_url(language), None::<&str>)
        .map_err(|e| e.to_string())
}

/// Settings › About Textus links, by name so the frontend can only pick one.
/// Discord and QQ go through the website's redirects, so invites can change.
fn about_url(page: &str) -> Option<&'static str> {
    match page {
        "github" => Some("https://github.com/CatVinci-Studio/Textus"),
        "discord" => Some("https://textus.catvinci.com/discord"),
        "qq" => Some("https://textus.catvinci.com/qq"),
        // Settings › Browse themes, when the gallery can't be reached.
        "themes" => Some("https://textus.catvinci.com/themes/"),
        // The market's How to list yours: what gets listed, and how.
        "listing" => Some("https://github.com/CatVinci-Studio/textus-plugins/blob/main/LISTING.md"),
        _ => None,
    }
}

#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn open_about_link(app: tauri::AppHandle, page: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let url = about_url(&page).ok_or_else(|| format!("no page {page}"))?;
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}

/// `url` if it is a web or mail link. Anything else (file:, javascript:, an
/// app's custom scheme) is refused rather than handed to the OS.
fn web_link(url: &str) -> Option<String> {
    let url = tauri::Url::parse(url).ok()?;
    matches!(url.scheme(), "http" | "https" | "mailto").then(|| url.to_string())
}

/// A link Ctrl/Cmd+clicked in a document.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn open_web_link(app: tauri::AppHandle, url: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let url = web_link(&url).ok_or_else(|| "not a web link".to_string())?;
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}

/// Help > Join the Community, and its row in Settings.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn open_community_page(
    app: tauri::AppHandle,
    language: Option<String>,
) -> Result<(), String> {
    open_community(&app, language.as_deref())
}

/// Help > Video Tutorials, its row in Settings, and the tour's "Watch the
/// animation" links, which name their `clip`.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn open_tutorials_page(
    app: tauri::AppHandle,
    clip: Option<String>,
    language: Option<String>,
) -> Result<(), String> {
    open_tutorials(&app, clip.as_deref(), language.as_deref())
}

#[cfg(test)]
mod tests {
    use super::{community_url, tutorials_url};

    #[test]
    fn every_tour_clip_opens_in_every_ui_language() {
        for ui in crate::ai::ui_language::UI_LANGUAGES {
            for clip in super::TUTORIAL_CLIPS {
                let url = tutorials_url(Some(clip), Some(ui.code)).unwrap();
                assert!(url.ends_with(&format!("tutorials/#{clip}")), "{url}");
            }
        }
        assert_eq!(
            tutorials_url(Some("grammar"), Some("en")).as_deref(),
            Some("https://textus.catvinci.com/tutorials/#grammar")
        );
        assert_eq!(
            tutorials_url(Some("ai-panel"), Some("zh-Hant")).as_deref(),
            Some("https://textus.catvinci.com/zh-hant/tutorials/#ai-panel")
        );
        assert_eq!(
            tutorials_url(None, Some("ja")).as_deref(),
            Some("https://textus.catvinci.com/ja/tutorials/")
        );
    }

    #[test]
    fn tutorials_open_only_the_clips_the_page_has() {
        assert!(tutorials_url(Some("https://example.com"), Some("en")).is_none());
        assert!(tutorials_url(Some("grammar\"#x"), Some("en")).is_none());
        assert!(tutorials_url(Some(""), Some("en")).is_none());
        // An unknown language gets the English page, never a made-up folder.
        assert_eq!(
            tutorials_url(Some("memory"), Some("../evil")).as_deref(),
            Some("https://textus.catvinci.com/tutorials/#memory")
        );
        assert_eq!(
            tutorials_url(None, None).as_deref(),
            Some("https://textus.catvinci.com/tutorials/")
        );
    }

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
    fn about_opens_only_its_own_pages() {
        assert!(super::about_url("github").is_some());
        assert!(super::about_url("qq").is_some());
        assert!(super::about_url("themes").is_some());
        assert!(super::about_url("https://example.com").is_none());
    }

    #[test]
    fn a_document_link_opens_only_on_the_web_or_in_mail() {
        assert_eq!(
            super::web_link("https://example.com/a b").as_deref(),
            Some("https://example.com/a%20b")
        );
        assert!(super::web_link("HTTP://example.com").is_some());
        assert!(super::web_link("mailto:me@example.com").is_some());
        for refused in [
            "file:///C:/Windows/System32/calc.exe",
            "javascript:alert(1)",
            "ms-settings:privacy",
            "smb://server/share",
            "./notes/ch1.md",
            "",
        ] {
            assert!(super::web_link(refused).is_none(), "{refused}");
        }
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
