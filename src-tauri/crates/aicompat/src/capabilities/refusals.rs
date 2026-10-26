//! A model that refuses the thinking it was asked for: remembered, and
//! the request sent again without it.

use super::*;

pub(crate) fn refusals() -> &'static Mutex<HashSet<String>> {
    static REFUSED: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    REFUSED.get_or_init(Default::default)
}

pub(crate) fn refused(provider_id: &str, model: &str) -> bool {
    refusals()
        .lock()
        .map(|set| set.contains(&format!("{provider_id}/{model}")))
        .unwrap_or(false)
}

pub(crate) fn remember_refusal(provider_id: &str, model: &str) {
    if let Ok(mut set) = refusals().lock() {
        set.insert(format!("{provider_id}/{model}"));
    }
}

/// Whether a failed request's error reads as the provider refusing a
/// thinking parameter: a 400 (or 422) whose body names one. Error strings
/// are the dialects' `"... request failed ({status}): {body}"`.
pub fn is_thinking_refusal(error: &str) -> bool {
    let lower = error.to_ascii_lowercase();
    let rejected = ["(400", "(422"].iter().any(|s| lower.contains(s));
    rejected
        && [
            "reasoning",
            "thinking",
            "effort",
            "output_config",
            "budget",
            "summary",
        ]
        .iter()
        .any(|field| lower.contains(field))
}

/// Runs `step` with `thinking`; when the provider refuses the parameters,
/// runs it once more without them and stops sending them to this model for
/// the rest of the session.
pub async fn with_fallback<T, F, Fut>(
    provider_id: &str,
    model: &str,
    thinking: &Thinking,
    mut step: F,
) -> Result<T, String>
where
    F: FnMut(Thinking) -> Fut,
    Fut: std::future::Future<Output = Result<T, String>>,
{
    match step(thinking.clone()).await {
        Err(error) if thinking.sends_parameters() && is_thinking_refusal(&error) => {
            remember_refusal(provider_id, model);
            step(thinking.without_parameters()).await
        }
        result => result,
    }
}
