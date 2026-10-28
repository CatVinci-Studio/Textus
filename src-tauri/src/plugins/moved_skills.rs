//! Skills that moved from built-in to the market: an older profile gets the
//! ones it had on installed once from the catalog, retried at the next start
//! when offline.

use crate::ai::workspace::{global_agent_dir, read_skill_files, DISABLED_BUILTINS_KEY};
use serde_json::{json, Map, Value};
use tauri::AppHandle;

/// The settings.json field naming the moved skills seen to; all of them from
/// the start in a new profile. `true`, from before it was a list, is the
/// first twelve.
pub(crate) const MOVED_KEY: &str = "skillsMovedToMarket";
const FIRST_MOVED: usize = 12;

/// The moved skills a profile has seen to, by what MOVED_KEY holds.
fn seen_to(value: Option<&Value>) -> Vec<&'static str> {
    let moved = crate::ai::builtin::MOVED_TO_MARKET;
    match value {
        Some(Value::Bool(true)) => moved[..FIRST_MOVED].to_vec(),
        Some(Value::Array(names)) => moved
            .iter()
            .copied()
            .filter(|m| names.iter().any(|n| n.as_str() == Some(m)))
            .collect(),
        _ => Vec::new(),
    }
}

/// MOVED_KEY with every moved skill seen to.
pub(crate) fn all_seen_to() -> Value {
    json!(crate::ai::builtin::MOVED_TO_MARKET)
}

/// The moved skills a profile had on, given its list of turned-off built-ins:
/// all of them without a list, else those not in it.
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

/// Installs the moved skills the profile had on and lacks, then marks the move
/// done. A failure leaves it for the next start.
pub async fn install_moved_skills(app: AppHandle) {
    let read = |key| crate::settings::read_setting(&app, key);
    let seen = seen_to(read(MOVED_KEY).as_ref());
    if seen.len() == crate::ai::builtin::MOVED_TO_MARKET.len() {
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
        .filter(|name| !seen.contains(name) && !have.iter().any(|h| h == name))
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
    patch.insert(MOVED_KEY.into(), all_seen_to());
    patch.insert(DISABLED_BUILTINS_KEY.into(), Value::Null);
    crate::settings::patch_from_backend(&app, patch);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_profile_keeps_the_moved_skills_it_had_on() {
        assert_eq!(
            had_on(None).len(),
            crate::ai::builtin::MOVED_TO_MARKET.len()
        );
        let off = json!(["email", "proofread", "headline"]);
        let on = had_on(Some(&off));
        assert!(!on.contains(&"email") && !on.contains(&"headline"));
        assert!(on.contains(&"describe"));
        assert_eq!(on.len(), crate::ai::builtin::MOVED_TO_MARKET.len() - 2);
    }

    #[test]
    fn a_profile_that_saw_to_the_first_move_still_gets_the_later_one() {
        let first = seen_to(Some(&json!(true)));
        assert_eq!(first.len(), FIRST_MOVED);
        assert!(!first.contains(&"translate"));
        assert!(seen_to(None).is_empty());
        assert_eq!(
            seen_to(Some(&all_seen_to())).len(),
            crate::ai::builtin::MOVED_TO_MARKET.len()
        );
    }
}
