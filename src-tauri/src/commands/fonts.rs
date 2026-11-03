//! The font families installed on this machine, for Settings › Editor's
//! text font.

/// Each family once, by the name CSS knows it, sorted as people read them.
/// Hidden system families (macOS's ".SF NS" and the like) are left out.
fn families(db: &fontdb::Database) -> Vec<String> {
    let mut names: Vec<String> = db
        .faces()
        .filter_map(|face| face.families.first().map(|(name, _)| name.trim().to_string()))
        .filter(|name| !name.is_empty() && !name.starts_with('.'))
        .collect();
    names.sort_by_key(|n| n.to_lowercase());
    names.dedup_by(|a, b| a.eq_ignore_ascii_case(b));
    names
}

#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn system_font_families() -> Vec<String> {
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
        let names = families(&db);
        assert!(names.iter().all(|n| !n.starts_with('.')));
        let mut lower: Vec<_> = names.iter().map(|n| n.to_lowercase()).collect();
        lower.dedup();
        assert_eq!(lower.len(), names.len());
    }
}
