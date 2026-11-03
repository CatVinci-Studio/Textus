//! Tools plugins give Textus AI: each window reports its plugins' tools, a
//! request offers them, and a call goes back to the offering window. Like MCP
//! tools, calls run one at a time, in order.

use crate::ai::tools::{Access, Run, Tool, EVERY_MODE};
use aicompat::agent::{ToolCall, ToolOutput, ToolSpec};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::oneshot;

/// How long a plugin has to answer a call.
const ANSWER_WITHIN: Duration = Duration::from_secs(60);
/// The most of an answer the model is shown.
const RESULT_CHARS: usize = 20_000;

/// One tool, as the window describes it from the plugin's manifest.
#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct PluginAiTool {
    pub plugin: String,
    /// The plugin's name for it.
    pub name: String,
    pub description: String,
    /// A JSON schema of its arguments.
    pub parameters: Value,
}

/// A call of a plugin's tool, sent to its window.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ToolCallEvent {
    call_id: String,
    plugin: String,
    name: String,
    arguments: Value,
}

#[derive(Default)]
pub struct PluginAiTools {
    /// By window label.
    offered: Mutex<HashMap<String, Vec<PluginAiTool>>>,
    waiting: Mutex<HashMap<String, oneshot::Sender<Result<String, String>>>>,
}

/// The tools a window's plugins offer now; none when it closes or its
/// plugins are off.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn plugin_ai_tools_set(app: AppHandle, window: tauri::Window, tools: Vec<PluginAiTool>) {
    let hub = app.state::<PluginAiTools>();
    let mut offered = hub.offered.lock().unwrap_or_else(|e| e.into_inner());
    if tools.is_empty() {
        offered.remove(window.label());
    } else {
        offered.insert(window.label().to_string(), tools);
    }
}

/// What a plugin's tool answered (`text`), or why it couldn't (`error`).
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn plugin_ai_tool_result(
    app: AppHandle,
    call_id: String,
    text: Option<String>,
    error: Option<String>,
) {
    let hub = app.state::<PluginAiTools>();
    let sender = hub
        .waiting
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(&call_id);
    if let Some(sender) = sender {
        let _ = sender.send(match error {
            Some(why) => Err(why),
            None => Ok(text.unwrap_or_default()),
        });
    }
}

/// A plugin's name in a tool's name and in its `textus` command: the last
/// part of its id.
pub fn short_name(plugin: &str) -> &str {
    plugin.rsplit('.').next().unwrap_or(plugin)
}

/// The model's name for a plugin's tool: `plugin_` and its name, in the
/// letters a tool name may have, at most 64.
fn model_name(plugin: &str, name: &str) -> String {
    let short = short_name(plugin);
    let mut out: String = format!("plugin_{short}_{name}")
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect();
    out.truncate(64);
    out
}

/// Every tool the windows' plugins offer, for this request.
pub fn tools_for_request<'a>(app: &AppHandle) -> Vec<Tool<'a>> {
    let hub = app.state::<PluginAiTools>();
    let offered = hub.offered.lock().unwrap_or_else(|e| e.into_inner());
    let mut taken: Vec<String> = Vec::new();
    let mut tools = Vec::new();
    for (window, list) in offered.iter() {
        for tool in list {
            let mut name = model_name(&tool.plugin, &tool.name);
            while taken.contains(&name) {
                name.push('_');
            }
            taken.push(name.clone());
            tools.push(plugin_tool(app.clone(), window.clone(), name, tool.clone()));
        }
    }
    tools
}

fn plugin_tool<'a>(app: AppHandle, window: String, name: String, tool: PluginAiTool) -> Tool<'a> {
    let mut parameters = tool.parameters.clone();
    if !parameters.is_object() {
        parameters = json!({ "type": "object" });
    }
    if parameters.get("properties").is_none() {
        parameters["properties"] = json!({});
    }
    let description = format!(
        "{}\n\n(A tool of the plugin {}, which the user installed.)",
        tool.description.trim(),
        tool.plugin
    );
    Tool {
        spec: ToolSpec {
            name: name.into(),
            description: description.into(),
            parameters,
        },
        access: Access::Proposes,
        modes: EVERY_MODE,
        run: Run::Async(Box::new(move |call: ToolCall| {
            let (app, window, tool) = (app.clone(), window.clone(), tool.clone());
            Box::pin(async move { run_call(&app, &window, &tool, call).await })
        })),
    }
}

async fn run_call(
    app: &AppHandle,
    window: &str,
    tool: &PluginAiTool,
    call: ToolCall,
) -> ToolOutput {
    let arguments = serde_json::from_str(&call.arguments).unwrap_or_else(|_| json!({}));
    let text = match call_tool(app, window, tool, call.call_id, arguments).await {
        Ok(text) => text,
        Err(why) => why,
    };
    trimmed(text).into()
}

/// Every tool offered now, with the window offering it: the same table the
/// model's tools come from, for the `textus` command.
#[cfg(desktop)]
pub fn offered_tools(app: &AppHandle) -> Vec<(String, PluginAiTool)> {
    let hub = app.state::<PluginAiTools>();
    let offered = hub.offered.lock().unwrap_or_else(|e| e.into_inner());
    offered
        .iter()
        .flat_map(|(window, list)| list.iter().map(|t| (window.clone(), t.clone())))
        .collect()
}

/// Runs a plugin's tool in its window: its answer, or why there is none.
pub async fn call_tool(
    app: &AppHandle,
    window: &str,
    tool: &PluginAiTool,
    call_id: String,
    arguments: Value,
) -> Result<String, String> {
    let (send, answer) = oneshot::channel();
    let hub = app.state::<PluginAiTools>();
    let forget = || {
        hub.waiting
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&call_id);
    };
    hub.waiting
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(call_id.clone(), send);
    let event = ToolCallEvent {
        call_id: call_id.clone(),
        plugin: tool.plugin.clone(),
        name: tool.name.clone(),
        arguments,
    };
    if app.emit_to(window, "plugin-ai-tool-call", event).is_err() {
        forget();
        return Err("The plugin's window is gone, so the tool couldn't run.".into());
    }
    match tokio::time::timeout(ANSWER_WITHIN, answer).await {
        Ok(Ok(Ok(text))) => Ok(text),
        Ok(Ok(Err(why))) => Err(format!("The plugin's tool failed: {why}")),
        Ok(Err(_)) | Err(_) => {
            forget();
            Err("The plugin didn't answer in time.".into())
        }
    }
}

fn trimmed(text: String) -> String {
    if text.trim().is_empty() {
        return "(The tool returned nothing.)".to_string();
    }
    if text.chars().count() > RESULT_CHARS {
        return text.chars().take(RESULT_CHARS).collect::<String>()
            + "\n[cut off: the rest was too long]";
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_tool_is_named_for_its_plugin_in_a_name_a_model_takes() {
        assert_eq!(
            model_name("catvinci.word-count", "count words"),
            "plugin_word-count_count_words"
        );
        assert!(model_name("a.b", &"x".repeat(100)).len() <= 64);
    }

    #[test]
    fn an_answer_is_cut_to_what_the_model_is_shown() {
        assert_eq!(trimmed("  ".into()), "(The tool returned nothing.)");
        let long = trimmed("x".repeat(RESULT_CHARS + 10));
        assert!(long.ends_with("[cut off: the rest was too long]"));
    }
}
