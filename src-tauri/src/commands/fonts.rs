//! The font families installed on this machine, for Settings › Editor's
//! text font.

use fontdb::Language;
use serde::Serialize;
use std::collections::BTreeMap;

/// One family: the name CSS knows it by, and what it is called in the UI's
/// languages where the font says (宋体 for SimSun), so it can be shown and
/// found by the name its reader knows. `FontFamily` in
/// src/settings/sections/font-families.ts reads it.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[cfg_attr(test, derive(specta::Type))]
pub struct FontFamily {
    pub name: String,
    /// By UI language code ("zh", "zh-Hant", "ja", ...).
    pub local: BTreeMap<String, String>,
}

/// The UI language a font's name is in, of those Textus speaks.
fn ui_lang(language: Language) -> Option<&'static str> {
    Some(match language.primary_language() {
        "Chinese" => match language.region() {
            "Taiwan" | "Hong Kong S.A.R." | "Macao S.A.R." => "zh-Hant",
            _ => "zh",
        },
        "Japanese" => "ja",
        "Korean" => "ko",
        // Spain's is "Spanish (Modern Sort)" or "(Traditional Sort)".
        spanish if spanish.starts_with("Spanish") => "es",
        "French" => "fr",
        "German" => "de",
        "Russian" => "ru",
        "Portuguese" => "pt",
        _ => return None,
    })
}

/// Each family once, by its first name (fontdb puts the English one first),
/// sorted as people read them. Hidden system families (macOS's ".SF NS" and
/// the like) are left out.
fn families(db: &fontdb::Database) -> Vec<FontFamily> {
    let mut by_key: BTreeMap<String, FontFamily> = BTreeMap::new();
    for face in db.faces() {
        let Some((first, _)) = face.families.first() else {
            continue;
        };
        let name = first.trim();
        if name.is_empty() || name.starts_with('.') {
            continue;
        }
        let family = by_key
            .entry(name.to_lowercase())
            .or_insert_with(|| FontFamily {
                name: name.to_string(),
                local: BTreeMap::new(),
            });
        for (local, language) in &face.families[1..] {
            let local = local.trim();
            if let Some(lang) = ui_lang(*language) {
                if !local.is_empty() && local != name {
                    family
                        .local
                        .entry(lang.to_string())
                        .or_insert_with(|| local.to_string());
                }
            }
        }
    }
    by_key.into_values().collect()
}

#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn system_font_families() -> Vec<FontFamily> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut db = fontdb::Database::new();
        db.load_system_fonts();
        families(&db)
    })
    .await
    .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_each_family_once_without_hidden_ones() {
        let mut db = fontdb::Database::new();
        db.load_system_fonts();
        let names: Vec<String> = families(&db).into_iter().map(|f| f.name).collect();
        assert!(names.iter().all(|n| !n.starts_with('.')));
        let mut lower: Vec<_> = names.iter().map(|n| n.to_lowercase()).collect();
        lower.dedup();
        assert_eq!(lower.len(), names.len());
    }

    #[test]
    fn names_a_font_in_the_ui_languages_it_carries() {
        assert_eq!(
            ui_lang(Language::Chinese_PeoplesRepublicOfChina),
            Some("zh")
        );
        assert_eq!(ui_lang(Language::Chinese_Taiwan), Some("zh-Hant"));
        assert_eq!(ui_lang(Language::Chinese_HongKongSAR), Some("zh-Hant"));
        assert_eq!(ui_lang(Language::Japanese_Japan), Some("ja"));
        assert_eq!(ui_lang(Language::German_Austria), Some("de"));
        assert_eq!(ui_lang(Language::Spanish_ModernSort_Spain), Some("es"));
        assert_eq!(ui_lang(Language::English_UnitedStates), None);
        assert_eq!(ui_lang(Language::Hungarian_Hungary), None);
    }
}
