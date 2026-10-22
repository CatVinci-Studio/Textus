//! How each model reasons, from the bundled capability data: the levels
//! it offers and whether it can think deeper.

use super::*;

/// What a model's thinking takes, per models.dev.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ModelReasoning {
    /// Not in the table: a custom endpoint, Ollama, OpenRouter's routers, a
    /// model newer than the last sync.
    Unknown,
    /// Doesn't reason.
    No,
    /// Reasons, and takes no setting.
    Fixed,
    Options {
        /// Can be switched off.
        toggle: bool,
        /// The effort levels it accepts, lowest first.
        efforts: Vec<String>,
        /// Takes a thinking-token budget, up to this many.
        budget: Option<u64>,
    },
}

#[derive(Deserialize)]
pub(crate) struct CapabilityFile {
    pub(crate) providers: HashMap<String, HashMap<String, ModelEntry>>,
}

#[derive(Deserialize)]
pub(crate) struct ModelEntry {
    pub(crate) reasoning: Value,
}

pub(crate) fn table() -> &'static HashMap<String, HashMap<String, ModelEntry>> {
    static TABLE: OnceLock<HashMap<String, HashMap<String, ModelEntry>>> = OnceLock::new();
    TABLE.get_or_init(|| {
        serde_json::from_str::<CapabilityFile>(include_str!("../../data/model-capabilities.json"))
            .map(|file| file.providers)
            .unwrap_or_default()
    })
}

pub(crate) fn parse_reasoning(value: &Value) -> ModelReasoning {
    match value {
        Value::Bool(false) => ModelReasoning::No,
        Value::Object(options) => ModelReasoning::Options {
            toggle: options.get("toggle").and_then(Value::as_bool) == Some(true),
            efforts: options
                .get("effort")
                .and_then(Value::as_array)
                .map(|values| {
                    values
                        .iter()
                        .filter_map(|v| v.as_str().map(str::to_string))
                        .collect()
                })
                .unwrap_or_default(),
            budget: options
                .get("budget")
                .map(|b| b.as_u64().unwrap_or(u64::MAX)),
        },
        _ => ModelReasoning::Fixed,
    }
}

pub fn model_reasoning(provider_id: &str, model: &str) -> ModelReasoning {
    table()
        .get(provider_id)
        .and_then(|models| models.get(model))
        .map(|entry| parse_reasoning(&entry.reasoning))
        .unwrap_or(ModelReasoning::Unknown)
}

/// Whether Deep thinking would change anything for this model - what shows
/// the composer's button. Off for a model that doesn't think, or thinks one
/// fixed way; on for one the table doesn't know, where the parameters are
/// tried and dropped if refused.
pub fn can_think_deeper(provider_id: &str, model: &str) -> bool {
    if provider(provider_id).thinking == ThinkingFormat::None {
        return false;
    }
    match model_reasoning(provider_id, model) {
        ModelReasoning::Unknown => true,
        ModelReasoning::No | ModelReasoning::Fixed => false,
        ModelReasoning::Options {
            toggle,
            efforts,
            budget,
        } => toggle || budget.is_some() || efforts.len() > 1,
    }
}
