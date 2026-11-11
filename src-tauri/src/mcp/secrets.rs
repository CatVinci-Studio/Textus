//! The secrets of the MCP servers - their environment's and headers' values,
//! often tokens - kept with the AI providers' keys, never in the settings:
//! there each stands as MASK, so no window holds it once saved.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use tauri::AppHandle;

/// What a saved secret reads as in the settings (and the form).
pub(crate) const MASK: &str = "••••••••";
/// Their place among the keys: an id never shown as a provider.
const STORE_ID: &str = "__mcp";
const FIELDS: [&str; 2] = ["env", "headers"];

/// By server id, then field ("env", "headers"), then name.
type Kept = HashMap<String, HashMap<String, HashMap<String, String>>>;

#[derive(Serialize, Deserialize)]
struct Store(Kept);

fn load(app: &AppHandle) -> Kept {
    crate::auth::keys::load_provider_key(app, STORE_ID)
        .ok()
        .flatten()
        .and_then(|text| serde_json::from_str::<Store>(&text).ok())
        .map(|store| store.0)
        .unwrap_or_default()
}

/// `servers` (the settings' list) with every value typed in moved to the
/// store and MASK left in its place; the store keeps only the secrets still
/// named. Whether the store changed.
pub(crate) fn seal(app: &AppHandle, servers: &mut Value) -> bool {
    let was = load(app);
    let kept = sealed(&was, servers);
    if kept == was {
        return false;
    }
    let text = serde_json::to_string(&Store(kept)).unwrap_or_default();
    crate::auth::keys::set_provider_api_key(app.clone(), STORE_ID.into(), text).is_ok()
}

/// What the store keeps after `servers` is sealed against what it kept.
fn sealed(was: &Kept, servers: &mut Value) -> Kept {
    let mut kept = Kept::new();
    for server in servers.as_array_mut().into_iter().flatten() {
        let Some(id) = server.get("id").and_then(Value::as_str).map(str::to_string) else {
            continue;
        };
        for field in FIELDS {
            let Some(pairs) = server.get_mut(field).and_then(Value::as_object_mut) else {
                continue;
            };
            for (name, value) in pairs.iter_mut() {
                let secret = match value.as_str() {
                    Some(MASK) => was
                        .get(&id)
                        .and_then(|s| s.get(field))
                        .and_then(|s| s.get(name))
                        .cloned(),
                    Some("") | None => None,
                    Some(typed) => Some(typed.to_string()),
                };
                if let Some(secret) = secret {
                    kept.entry(id.clone())
                        .or_default()
                        .entry(field.to_string())
                        .or_default()
                        .insert(name.clone(), secret);
                    *value = Value::String(MASK.to_string());
                }
            }
        }
    }
    kept
}

/// The server's MASK values as kept, for starting or trying it.
pub(crate) fn unmask(
    app: &AppHandle,
    id: &str,
    env: &mut HashMap<String, String>,
    headers: &mut HashMap<String, String>,
) {
    let kept = load(app);
    let Some(server) = kept.get(id) else {
        return;
    };
    for (field, pairs) in [("env", env), ("headers", headers)] {
        for (name, value) in pairs.iter_mut() {
            if value == MASK {
                if let Some(secret) = server.get(field).and_then(|s| s.get(name)) {
                    value.clone_from(secret);
                }
            }
        }
    }
}

/// Moves secrets left in the saved settings (from before, or written by
/// another build) into the store. Run once at startup.
pub(crate) fn seal_saved(app: &AppHandle) {
    let Some(mut servers) = crate::settings::read_setting(app, super::SERVERS_KEY) else {
        return;
    };
    let before = servers.clone();
    seal(app, &mut servers);
    if servers != before {
        let mut patch = serde_json::Map::new();
        patch.insert(super::SERVERS_KEY.to_string(), servers);
        crate::settings::patch_from_backend(app, patch);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_typed_value_is_kept_apart_and_masked_a_masked_one_stays_and_a_gone_one_goes() {
        let mut servers = json!([
            { "id": "a", "env": { "TOKEN": "s3cret", "EMPTY": "" }, "headers": {} },
        ]);
        let kept = sealed(&Kept::new(), &mut servers);
        assert_eq!(servers[0]["env"]["TOKEN"], MASK);
        assert_eq!(servers[0]["env"]["EMPTY"], "");
        assert_eq!(kept["a"]["env"]["TOKEN"], "s3cret");

        // Saved again unchanged: the secret stays; the server removed: it goes.
        let mut again = servers.clone();
        assert_eq!(sealed(&kept, &mut again), kept);
        assert!(sealed(&kept, &mut json!([])).is_empty());
    }
}
