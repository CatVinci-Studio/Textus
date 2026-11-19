//! `textus.ai.complete` and `textus.ai.stream`: a plugin asking the user's
//! writing model, with the `ai.model` permission, the user's yes on its
//! first call, and a monthly allowance of tokens kept here, in
//! `plugins/ai.json`, where the plugin can't reach it.

use super::{plugins_root, require_id};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::sync::Mutex;

/// A plugin's tokens a month until the user allows more.
pub const MONTHLY_TOKENS: u64 = 100_000;

/// The longest system text plus prompt a plugin may send, in characters.
const LONGEST_INPUT: usize = 200_000;

/// Refusals the frontend turns into a question for the user.
pub const NOT_ALLOWED: &str = "plugin-ai-not-allowed";
pub const OVER_LIMIT: &str = "plugin-ai-limit";

static WRITING: Mutex<()> = Mutex::new(());

#[derive(Serialize, Deserialize, Default, Clone, Debug, PartialEq)]
struct Usage {
    /// "2026-11": counts start again in a new month.
    #[serde(default)]
    month: String,
    #[serde(default)]
    plugins: BTreeMap<String, PluginUsage>,
}

#[derive(Serialize, Deserialize, Default, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
struct PluginUsage {
    /// The user said yes to its first call.
    #[serde(default)]
    allowed: bool,
    /// Tokens this month, as counted by `tokens`.
    #[serde(default)]
    used: u64,
    /// What the user allowed beyond the allowance, this month.
    #[serde(default)]
    extra: u64,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct PluginAiStatus {
    /// Textus AI is on.
    pub on: bool,
    pub allowed: bool,
    pub used: u32,
    pub limit: u32,
}

/// About how many tokens a text is: a CJK character is one, other text one
/// for every four characters.
pub(crate) fn tokens(text: &str) -> u64 {
    let (wide, other) = text.chars().fold((0u64, 0u64), |(w, o), c| {
        if is_wide(c) {
            (w + 1, o)
        } else {
            (w, o + 1)
        }
    });
    wide + other.div_ceil(4)
}

fn is_wide(c: char) -> bool {
    matches!(c as u32,
        0x3040..=0x30ff | 0x3400..=0x4dbf | 0x4e00..=0x9fff | 0xac00..=0xd7af | 0xf900..=0xfaff)
}

fn this_month() -> String {
    chrono::Local::now().format("%Y-%m").to_string()
}

fn read(app: &tauri::AppHandle) -> Usage {
    let usage: Usage = plugins_root(app)
        .ok()
        .and_then(|root| crate::json_file::read_or_set_aside(&root.join("ai.json")))
        .unwrap_or_default();
    fresh(usage, &this_month())
}

/// `usage` as it stands in `month`: last month's counts and extras gone,
/// the yeses kept.
fn fresh(mut usage: Usage, month: &str) -> Usage {
    if usage.month != month {
        usage.month = month.to_string();
        for entry in usage.plugins.values_mut() {
            entry.used = 0;
            entry.extra = 0;
        }
    }
    usage
}

fn update<T>(app: &tauri::AppHandle, change: impl FnOnce(&mut Usage) -> T) -> Result<T, String> {
    let _guard = WRITING.lock().unwrap_or_else(|e| e.into_inner());
    let mut usage = read(app);
    let out = change(&mut usage);
    let root = plugins_root(app)?;
    crate::json_file::save_pretty(&root.join("ai.json"), &usage).map_err(|e| e.to_string())?;
    Ok(out)
}

fn status_of(entry: Option<&PluginUsage>, on: bool) -> PluginAiStatus {
    let entry = entry.cloned().unwrap_or_default();
    let clamp = |n: u64| u32::try_from(n).unwrap_or(u32::MAX);
    PluginAiStatus {
        on,
        allowed: entry.allowed,
        used: clamp(entry.used),
        limit: clamp(MONTHLY_TOKENS + entry.extra),
    }
}

/// The refusal for a call now, or None to go ahead.
fn refusal(entry: Option<&PluginUsage>) -> Option<&'static str> {
    match entry {
        Some(e) if e.allowed => (e.used >= MONTHLY_TOKENS + e.extra).then_some(OVER_LIMIT),
        _ => Some(NOT_ALLOWED),
    }
}

/// Whether Textus AI is on, and the plugin's yes and tokens this month.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn plugin_ai_status(app: tauri::AppHandle, plugin: String) -> Result<PluginAiStatus, String> {
    require_id(&plugin)?;
    let on = crate::ai::ensure_on(&app).is_ok();
    Ok(status_of(read(&app).plugins.get(&plugin), on))
}

/// The user's yes to a plugin's first call; `more` also allows another
/// month's allowance, for this month.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn plugin_ai_allow(app: tauri::AppHandle, plugin: String, more: bool) -> Result<(), String> {
    require_id(&plugin)?;
    update(&app, |usage| {
        let entry = usage.plugins.entry(plugin).or_default();
        entry.allowed = true;
        if more {
            entry.extra += MONTHLY_TOKENS;
        }
    })
}

/// The writing model a plugin's call goes to, once the plugin may make it:
/// `ai.model` granted, the user's yes, tokens left this month, and an
/// input within bounds.
async fn checked_model(
    app: &tauri::AppHandle,
    plugin: &str,
    system: &str,
    prompt: &str,
) -> Result<(String, Option<String>), String> {
    require_id(plugin)?;
    crate::ai::ensure_on(app)?;
    let state = super::state::read(app);
    let granted = state
        .plugins
        .get(plugin)
        .is_some_and(|p| p.enabled && p.granted.iter().any(|g| g == "ai.model"));
    if !state.all_on || !granted {
        return Err("This plugin may not use your AI model (ai.model).".into());
    }
    if let Some(no) = refusal(read(app).plugins.get(plugin)) {
        return Err(no.into());
    }
    if system.chars().count() + prompt.chars().count() > LONGEST_INPUT {
        return Err(format!("At most {LONGEST_INPUT} characters can be sent."));
    }
    let setting = |key: &str| crate::settings::read_setting(app, key);
    let provider = [setting("writingProvider"), setting("aiProvider")]
        .into_iter()
        .flatten()
        .find_map(|v| v.as_str().filter(|s| !s.is_empty()).map(str::to_string))
        .ok_or_else(|| crate::ai::route::NOT_CONFIGURED.to_string())?;
    let model = setting("writingModels")
        .and_then(|m| {
            m.get(&provider)
                .and_then(|v| v.as_str())
                .map(str::to_string)
        })
        .filter(|m| !m.is_empty());
    Ok((provider, model))
}

/// Counts a call's tokens against the plugin's month.
fn spend(
    app: &tauri::AppHandle,
    plugin: String,
    sent: &[&str],
    answer: &str,
) -> Result<(), String> {
    let spent = sent.iter().map(|text| tokens(text)).sum::<u64>() + tokens(answer);
    update(app, |usage| {
        usage.plugins.entry(plugin).or_default().used += spent;
    })
}

/// The writing model's answer to `prompt`, for a plugin with `ai.model`
/// that the user allowed and that has tokens left this month. Cancelled
/// by `cancel_id` (plugin_http_cancel), only the question is counted.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn plugin_ai_complete(
    app: tauri::AppHandle,
    plugin: String,
    system: String,
    prompt: String,
    cancel_id: Option<String>,
) -> Result<String, String> {
    let (provider, model) = checked_model(&app, &plugin, &system, &prompt).await?;
    let (sent_system, sent_prompt) = (system.clone(), prompt.clone());
    let call = crate::ai::client::call(&app, &provider, system, prompt, model.as_deref());
    let answer = super::http::cancellable(&plugin, cancel_id, call).await;
    if let Some(written) = counted(&answer, String::new()) {
        spend(&app, plugin, &[&sent_system, &sent_prompt], &written)?;
    }
    answer
}

/// What a call spent: its answer, or what was written of it when it was
/// cancelled; nothing when it failed.
fn counted(answer: &Result<String, String>, so_far: String) -> Option<String> {
    match answer {
        Ok(text) => Some(text.clone()),
        Err(e) if e == "cancelled" => Some(so_far),
        Err(_) => None,
    }
}

/// [`plugin_ai_complete`], the answer streamed to `on_text` as it comes;
/// the whole returned. Cancelled, what was written so far is counted.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn plugin_ai_stream(
    app: tauri::AppHandle,
    plugin: String,
    system: String,
    prompt: String,
    on_text: tauri::ipc::Channel<String>,
    cancel_id: Option<String>,
) -> Result<String, String> {
    let (provider, model) = checked_model(&app, &plugin, &system, &prompt).await?;
    let (sent_system, sent_prompt) = (system.clone(), prompt.clone());
    let written = Mutex::new(String::new());
    let send = |text: &str| {
        if let Ok(mut so_far) = written.lock() {
            so_far.push_str(text);
        }
        let _ = on_text.send(text.to_string());
    };
    let stream =
        crate::ai::client::stream(&app, &provider, system, prompt, model.as_deref(), &send);
    let answer = super::http::cancellable(&plugin, cancel_id, stream).await;
    let so_far = written.lock().map(|s| s.clone()).unwrap_or_default();
    if let Some(written) = counted(&answer, so_far) {
        spend(&app, plugin, &[&sent_system, &sent_prompt], &written)?;
    }
    answer
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokens_count_cjk_by_character_and_other_text_by_four() {
        assert_eq!(tokens(""), 0);
        assert_eq!(tokens("abcd"), 1);
        assert_eq!(tokens("abcde"), 2);
        assert_eq!(tokens("春天的花园"), 5);
        assert_eq!(tokens("春天 spring"), 2 + 2);
    }

    #[test]
    fn a_new_month_starts_counting_again_and_keeps_the_yes() {
        let mut usage = Usage {
            month: "2026-10".into(),
            ..Default::default()
        };
        usage.plugins.insert(
            "a.b".into(),
            PluginUsage {
                allowed: true,
                used: 90_000,
                extra: MONTHLY_TOKENS,
            },
        );
        let now = fresh(usage.clone(), "2026-10");
        assert_eq!(now, usage);
        let next = fresh(usage, "2026-11");
        let entry = &next.plugins["a.b"];
        assert!(entry.allowed);
        assert_eq!((entry.used, entry.extra), (0, 0));
    }

    #[test]
    fn a_call_waits_for_the_yes_and_stops_at_the_allowance() {
        assert_eq!(refusal(None), Some(NOT_ALLOWED));
        let mut entry = PluginUsage {
            allowed: true,
            used: MONTHLY_TOKENS - 1,
            extra: 0,
        };
        assert_eq!(refusal(Some(&entry)), None);
        entry.used = MONTHLY_TOKENS;
        assert_eq!(refusal(Some(&entry)), Some(OVER_LIMIT));
        entry.extra = MONTHLY_TOKENS;
        assert_eq!(refusal(Some(&entry)), None);
        assert_eq!(status_of(Some(&entry), true).limit, 200_000);
    }
}
