//! The skills that were built in until 1.3.0-beta.2 and are in the market
//! now (ai::builtin::MOVED_TO_MARKET): a profile from before then gets the
//! ones it had on installed from the catalog once, into the global skills/
//! folder, so nothing it used goes missing. Offline, it tries again at the
//! next start.

use crate::ai::workspace::{global_agent_dir, read_skill_files, DISABLED_BUILTINS_KEY};
use serde_json::{json, Map, Value};
use tauri::AppHandle;

/// The settings.json field saying the moved skills have been seen to - set
/// from the start in a new profile (settings::Stores::load).
pub(crate) const MOVED_KEY: &str = "skillsMovedToMarket";

/// The moved skills a profile had on, given its list of turned-off
/// built-ins: every one for a profile without the list (1.2 had them all
/// on), else those not in it.
pub(crate) fn had_on(disabled: Option<&Value>) -> Vec<&'static str> {
    let off: Vec<&str> = disabled
        .and_then(Value::as_array)
        .map(|list| list.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default();
    crate::ai::builtin::MOVED_TO_MARKET
        .iter()
        .copied()
        .filter(|name| !off.contains(name))
        .collect()
}

/// Installs the moved skills the profile had on and doesn't have yet,
/// then marks the move done. A catalog that can't be reached, or a skill
/// that can't be installed, leaves it for the next start.
pub async fn install_moved_skills(app: AppHandle) {
    let read = |key| crate::settings::read_setting(&app, key);
    if read(MOVED_KEY) == Some(Value::Bool(true)) {
        return;
    }
    let Ok(dir) = global_agent_dir(&app).map(|d| d.join("skills")) else {
        return;
    };
    let have: Vec<String> = read_skill_files(&dir)
        .into_iter()
        .map(|(_, s)| s.name)
        .collect();
    let todo: Vec<&str> = had_on(read(DISABLED_BUILTINS_KEY).as_ref())
        .into_iter()
        .filter(|name| !have.iter().any(|h| h == name))
        .collect();
    if !todo.is_empty() {
        if super::catalog::plugin_catalog(app.clone()).await.is_err() {
            return;
        }
        for name in todo {
            match super::catalog::skill_install_catalog(app.clone(), name.to_string()).await {
                Ok(_) => {}
                Err(e) if e == super::catalog::SKILL_EXISTS => {}
                Err(_) => return,
            }
        }
    }
    let mut patch = Map::new();
    patch.insert(MOVED_KEY.into(), json!(true));
    patch.insert(DISABLED_BUILTINS_KEY.into(), Value::Null);
    crate::settings::patch_from_backend(&app, patch);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_profile_keeps_the_moved_skills_it_had_on() {
        assert_eq!(had_on(None).len(), crate::ai::builtin::MOVED_TO_MARKET.len());
        let off = json!(["email", "proofread", "headline"]);
        let on = had_on(Some(&off));
        assert!(!on.contains(&"email") && !on.contains(&"headline"));
        assert!(on.contains(&"describe"));
        assert_eq!(on.len(), crate::ai::builtin::MOVED_TO_MARKET.len() - 2);
    }
}
