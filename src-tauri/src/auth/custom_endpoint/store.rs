//! The custom endpoints as kept on disk, and the rules for changing them:
//! pure, so the migration and the key rule are tested without a file.

use serde::{Deserialize, Serialize};

/// The provider id the one endpoint before the list kept, and so still the
/// id of the endpoint migrated from it: settings that name it hold.
pub const FIRST_ID: &str = "custom";
/// What every other endpoint's provider id starts with.
const ID_PREFIX: &str = "custom:";

/// Whether a provider id names one of the user's endpoints. As `isCustomId`
/// in `src/ai/custom-endpoints.ts`.
pub fn is_custom_id(id: &str) -> bool {
    id == FIRST_ID || id.starts_with(ID_PREFIX)
}

/// A fresh provider id for a new endpoint.
pub fn new_id() -> String {
    format!(
        "{ID_PREFIX}{}",
        &uuid::Uuid::new_v4().simple().to_string()[..8]
    )
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct CustomEndpoint {
    /// Its provider id, as `Settings.aiProvider` names it.
    pub id: String,
    /// What the user called it; empty shows as "Custom endpoint".
    #[serde(default)]
    pub name: String,
    pub base_url: String,
    pub api_key: Option<String>,
    pub model: String,
}

/// The single endpoint's file before there could be several.
#[derive(Deserialize)]
pub(super) struct Legacy {
    base_url: String,
    api_key: Option<String>,
    model: String,
}

#[derive(Serialize, Deserialize, Default)]
pub(super) struct List {
    endpoints: Vec<CustomEndpoint>,
}

/// Either shape the file has had. Untagged, so the old one still parses
/// instead of being set aside as broken, and its key kept.
#[derive(Deserialize)]
#[serde(untagged)]
pub(super) enum StoredFile {
    List(List),
    Legacy(Legacy),
}

impl StoredFile {
    pub fn into_endpoints(self) -> Vec<CustomEndpoint> {
        match self {
            StoredFile::List(list) => list.endpoints,
            StoredFile::Legacy(old) => vec![CustomEndpoint {
                id: FIRST_ID.to_string(),
                name: String::new(),
                base_url: old.base_url,
                api_key: old.api_key,
                model: old.model,
            }],
        }
    }
}

/// The file's text for `endpoints`.
pub fn to_json(endpoints: Vec<CustomEndpoint>) -> Result<String, String> {
    serde_json::to_string(&List { endpoints }).map_err(|e| e.to_string())
}

/// What the settings page asks to save.
pub struct Edit {
    /// None for a new endpoint.
    pub id: Option<String>,
    pub name: String,
    pub base_url: String,
    pub api_key: Option<String>,
    pub model: String,
}

/// `endpoints` with `edit` saved over its endpoint, or added as a new one
/// with `fresh_id`; and its id. An unknown id is added rather than lost.
pub fn save(
    mut endpoints: Vec<CustomEndpoint>,
    edit: Edit,
    fresh_id: impl FnOnce() -> String,
) -> (Vec<CustomEndpoint>, String) {
    let at = edit
        .id
        .as_deref()
        .and_then(|id| endpoints.iter().position(|e| e.id == id));
    let api_key = resolve_key(at.map(|i| &endpoints[i]), &edit.base_url, edit.api_key);
    let endpoint = CustomEndpoint {
        id: edit.id.unwrap_or_else(fresh_id),
        name: edit.name.trim().to_string(),
        base_url: edit.base_url.trim().to_string(),
        api_key,
        model: edit.model.trim().to_string(),
    };
    let id = endpoint.id.clone();
    match at {
        Some(i) => endpoints[i] = endpoint,
        None => endpoints.push(endpoint),
    }
    (endpoints, id)
}

/// The key typed, else the endpoint's stored one, but only for the URL it was
/// saved with, so a new host never gets the old key.
pub fn resolve_key(
    stored: Option<&CustomEndpoint>,
    base_url: &str,
    typed: Option<String>,
) -> Option<String> {
    if let Some(key) = typed.filter(|k| !k.trim().is_empty()) {
        return Some(key);
    }
    stored
        .filter(|c| same_endpoint(&c.base_url, base_url))
        .and_then(|c| c.api_key.clone())
}

fn same_endpoint(a: &str, b: &str) -> bool {
    a.trim().trim_end_matches('/') == b.trim().trim_end_matches('/')
}

#[cfg(test)]
mod tests {
    use super::*;

    fn endpoint(id: &str, url: &str, key: Option<&str>) -> CustomEndpoint {
        CustomEndpoint {
            id: id.into(),
            name: String::new(),
            base_url: url.into(),
            api_key: key.map(str::to_string),
            model: "m".into(),
        }
    }

    fn edit(id: Option<&str>, url: &str, key: Option<&str>) -> Edit {
        Edit {
            id: id.map(str::to_string),
            name: "Relay".into(),
            base_url: url.into(),
            api_key: key.map(str::to_string),
            model: "m2".into(),
        }
    }

    #[test]
    fn the_single_endpoint_file_becomes_the_first_entry_with_its_key_and_model() {
        let old =
            r#"{"base_url":"https://relay.example/v1","api_key":"sk-old","model":"gpt-6-luna"}"#;
        let parsed: StoredFile = serde_json::from_str(old).expect("the old file still parses");
        assert_eq!(
            parsed.into_endpoints(),
            [CustomEndpoint {
                id: "custom".into(),
                name: String::new(),
                base_url: "https://relay.example/v1".into(),
                api_key: Some("sk-old".into()),
                model: "gpt-6-luna".into(),
            }]
        );
        // Written back as a list, it reads the same.
        let written = to_json(
            serde_json::from_str::<StoredFile>(old)
                .unwrap()
                .into_endpoints(),
        )
        .unwrap();
        let again: StoredFile = serde_json::from_str(&written).unwrap();
        assert_eq!(again.into_endpoints()[0].api_key.as_deref(), Some("sk-old"));
    }

    #[test]
    fn endpoints_match_ignoring_a_trailing_slash_only() {
        assert!(same_endpoint(
            "http://localhost:11434/v1/",
            "http://localhost:11434/v1"
        ));
        assert!(!same_endpoint(
            "http://localhost:11434/v1",
            "https://evil.example/v1"
        ));
    }

    #[test]
    fn the_stored_key_only_goes_to_the_url_it_was_saved_for() {
        let stored = endpoint("custom", "https://api.example/v1", Some("sk-stored"));
        let stored = Some(&stored);
        // Re-saved or tested with the key field left blank.
        assert_eq!(
            resolve_key(stored, "https://api.example/v1/", None).as_deref(),
            Some("sk-stored")
        );
        assert_eq!(
            resolve_key(stored, "https://api.example/v1", Some(" ".into())).as_deref(),
            Some("sk-stored")
        );
        // Moved to another host: the old key stays behind.
        assert_eq!(resolve_key(stored, "http://other.example/v1", None), None);
        // A typed key always wins; nothing stored means no key.
        assert_eq!(
            resolve_key(stored, "http://other.example/v1", Some("sk-new".into())).as_deref(),
            Some("sk-new")
        );
        assert_eq!(resolve_key(None, "https://api.example/v1", None), None);
    }

    #[test]
    fn a_blank_key_keeps_only_that_endpoints_own_key() {
        let list = vec![
            endpoint("custom", "https://a.example/v1", Some("sk-a")),
            endpoint("custom:b", "https://b.example/v1", Some("sk-b")),
        ];
        // Saved again with the field blank: its own key stays.
        let (saved, id) = save(
            list.clone(),
            edit(Some("custom:b"), "https://b.example/v1", None),
            || unreachable!(),
        );
        assert_eq!(id, "custom:b");
        assert_eq!(saved.len(), 2);
        assert_eq!(saved[1].api_key.as_deref(), Some("sk-b"));
        assert_eq!(saved[1].name, "Relay");
        assert_eq!(saved[0], list[0]);
        // A new endpoint at another's address doesn't take that one's key.
        let (saved, id) = save(list, edit(None, "https://a.example/v1", None), || {
            "custom:new".into()
        });
        assert_eq!(id, "custom:new");
        assert_eq!(saved.len(), 3);
        assert_eq!(saved[2].api_key, None);
    }

    #[test]
    fn endpoint_ids_are_told_from_catalog_ids() {
        assert!(is_custom_id("custom"));
        assert!(is_custom_id(&new_id()));
        assert!(!is_custom_id("openai"));
        assert!(!is_custom_id("customer"));
    }
}
