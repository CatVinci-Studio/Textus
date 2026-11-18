//! The font families installed on this machine, for Settings › Editor's
//! text font.

use fontdb::Language;
use serde::Serialize;

/// An installed family: the name CSS knows it by, and what it is called in
/// the CJK languages that name it themselves (微软雅黑 for Microsoft YaHei).
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct FontFamily {
    name: String,
    local: Vec<LocalName>,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[cfg_attr(test, derive(specta::Type))]
pub struct LocalName {
    /// "zh", "zh-Hant", "ja" or "ko", as Settings › Language spells them.
    language: String,
    name: String,
}

fn cjk(language: Language) -> Option<&'static str> {
    use Language::*;
    match language {
        Chinese_PeoplesRepublicOfChina | Chinese_Singapore => Some("zh"),
        Chinese_Taiwan | Chinese_HongKongSAR | Chinese_MacaoSAR => Some("zh-Hant"),
        Japanese_Japan => Some("ja"),
        Korean_Korea => Some("ko"),
        _ => None,
    }
}

/// Each family once, by the name CSS knows it, sorted as people read them.
/// Hidden system families (macOS's ".SF NS" and the like) are left out.
fn families(db: &fontdb::Database) -> Vec<FontFamily> {
    let mut list: Vec<FontFamily> = db
        .faces()
        .filter_map(|face| {
            let (name, _) = face.families.first()?;
            let name = name.trim().to_string();
            let mut local: Vec<LocalName> = face
                .families
                .iter()
                .filter_map(|(local, language)| {
                    let local = local.trim();
                    (local != name && !local.is_empty()).then_some(LocalName {
                        language: cjk(*language)?.to_string(),
                        name: local.to_string(),
                    })
                })
                .collect();
            local.dedup_by(|a, b| a.language == b.language);
            Some(FontFamily { name, local })
        })
        .filter(|f| !f.name.is_empty() && !f.name.starts_with('.'))
        .collect();
    list.sort_by_key(|f| f.name.to_lowercase());
    list.dedup_by(|a, b| {
        let same = a.name.eq_ignore_ascii_case(&b.name);
        if same && b.local.is_empty() {
            b.local = std::mem::take(&mut a.local);
        }
        same
    });
    list
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
    fn names_cjk_languages_only() {
        assert_eq!(cjk(Language::Chinese_PeoplesRepublicOfChina), Some("zh"));
        assert_eq!(cjk(Language::Chinese_Taiwan), Some("zh-Hant"));
        assert_eq!(cjk(Language::German_Germany), None);
    }
}
