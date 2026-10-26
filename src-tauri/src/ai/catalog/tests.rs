use super::*;

/// The reviewed copy of what each provider serves. Test-only.
const SNAPSHOT: &str = include_str!("../../../../src/ai/models-snapshot.json");

/// The capability table needs a row for every provider here: a missing row
/// silently falls back to plain Chat Completions, wrong for most providers.
#[test]
fn every_provider_has_a_capability_row() {
    for entry in PROVIDER_CATALOG {
        assert!(
            aicompat::capabilities::has_row(entry.id),
            "`{}` has no row in aicompat/src/capabilities.rs",
            entry.id
        );
    }
}

#[test]
fn deep_thinking_follows_the_default_agent_model() {
    assert!(ai_can_think_deeper("anthropic".into(), None));
    assert!(ai_can_think_deeper(
        "anthropic".into(),
        Some("claude-haiku-5-5".into())
    ));
    assert!(!ai_can_think_deeper("mistral".into(), None));
    assert!(!ai_can_think_deeper("openai".into(), Some("gpt-4o".into())));
}

/// Every model the catalog pins must still exist upstream and not be
/// deprecated. A failure after a snapshot refresh means re-pick the models.
#[test]
fn pinned_models_are_current_per_models_dev() {
    let snapshot: serde_json::Value = serde_json::from_str(SNAPSHOT).unwrap();
    let unmapped: Vec<&str> = snapshot["unmapped"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|v| v.as_str())
        .collect();
    for entry in PROVIDER_CATALOG {
        if unmapped.contains(&entry.id) {
            continue;
        }
        let models = &snapshot["providers"][entry.id]["models"];
        assert!(
                models.is_object(),
                "`{}` is in neither `providers` nor `unmapped` of models-snapshot.json - map it in scripts/sync-models.mjs",
                entry.id
            );
        let pinned = entry
            .default_model
            .iter()
            .chain(entry.agent_default_model.iter())
            .chain(entry.known_models.iter());
        for model in pinned {
            let found = &models[*model];
            assert!(
                found.is_object(),
                "{}/{model} is no longer listed by models.dev",
                entry.id
            );
            assert_ne!(
                found["status"], "deprecated",
                "{}/{model} is deprecated upstream",
                entry.id
            );
        }
    }
}
