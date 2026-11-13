//! External AI agents a plugin names (`contributes.agents`): Claude Code,
//! Codex and the like, started as a child process the window talks the
//! Agent Client Protocol to, a JSON message a line. Only a running plugin
//! granted `agents` starts one, and only the command its manifest names;
//! the window never passes a command.

use crate::plugins::access::plugin_home;
use crate::plugins::state;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;
use tauri::Manager;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

/// What an agent's process says, in order.
#[derive(Clone, serde::Serialize)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum AgentOutput {
    /// Lines of its stdout, a protocol message each, gathered for a moment
    /// so a stream of tokens reaches the window a few times a frame at most.
    Lines { lines: Vec<String> },
    /// It ended; the end of its stderr says why.
    Exit { code: Option<i32>, stderr: String },
}

type Stdin = Arc<tokio::sync::Mutex<tokio::process::ChildStdin>>;

struct Running {
    stdin: Stdin,
    child: Arc<Mutex<tokio::process::Child>>,
    /// The window that started it: it ends when that window closes.
    window: String,
}

/// The agents running in this app, by handle.
#[derive(Default)]
pub struct Agents {
    next: AtomicU64,
    running: Mutex<HashMap<u64, Running>>,
}

/// How a manifest says to start one of its agents.
#[derive(Debug, PartialEq)]
struct Launch {
    command: String,
    args: Vec<String>,
    env: Vec<(String, String)>,
}

/// The agent `agent` of `manifest`, its `{pluginDir}` filled with `home`.
fn launch(manifest: &Value, agent: &str, home: &str) -> Result<Launch, String> {
    let entry = manifest["contributes"]["agents"]
        .as_array()
        .and_then(|list| list.iter().find(|a| a["id"].as_str() == Some(agent)))
        .ok_or_else(|| format!("No agent {agent}."))?;
    let fill = |s: &str| s.replace("{pluginDir}", home);
    let command = entry["command"]
        .as_str()
        .filter(|c| !c.trim().is_empty())
        .ok_or("An agent needs a command.")?;
    let args = entry["args"]
        .as_array()
        .map(|a| a.iter().filter_map(Value::as_str).map(fill).collect())
        .unwrap_or_default();
    let env = entry["env"]
        .as_object()
        .map(|m| {
            m.iter()
                .filter_map(|(k, v)| Some((k.clone(), fill(v.as_str()?))))
                .collect()
        })
        .unwrap_or_default();
    Ok(Launch {
        command: fill(command),
        args,
        env,
    })
}

/// Starts agent `agent` of plugin `plugin` in `cwd`; its output goes to
/// `on_output`. Returns the handle `agent_send` and `agent_stop` take.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn agent_start(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    plugin: String,
    agent: String,
    cwd: Option<String>,
    on_output: Channel<AgentOutput>,
) -> Result<u64, String> {
    crate::ai::ensure_on(&app)?;
    let plugins = state::read(&app);
    if !plugins.allows(&plugin, "agents") {
        return Err(crate::plugins::access::refused(&plugin, "agents"));
    }
    let home = plugin_home(&app, &plugins, &plugin)?;
    let manifest: Value = serde_json::from_slice(
        &std::fs::read(home.join("textus-plugin.json")).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    let launch = launch(&manifest, &agent, &home.to_string_lossy())?;
    crate::mcp::path::ready_login_path().await;
    let crate::mcp::process::Piped {
        child,
        stdin,
        stdout,
        stderr: kept,
    } = crate::mcp::process::start(&launch.command, &launch.args, &launch.env, cwd.as_deref())?;
    let agents = app.state::<Agents>();
    let handle = agents.next.fetch_add(1, Ordering::Relaxed) + 1;
    let child = Arc::new(Mutex::new(child));
    agents
        .running
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(
            handle,
            Running {
                stdin: Arc::new(tokio::sync::Mutex::new(stdin)),
                child: child.clone(),
                window: window.label().to_string(),
            },
        );
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        let mut open = true;
        while open {
            let Ok(Some(first)) = lines.next_line().await else {
                break;
            };
            let mut batch = vec![first];
            let until = tokio::time::Instant::now() + GATHER;
            loop {
                match tokio::time::timeout_at(until, lines.next_line()).await {
                    Ok(Ok(Some(line))) => batch.push(line),
                    Ok(_) => {
                        open = false;
                        break;
                    }
                    Err(_) => break,
                }
            }
            let batch: Vec<String> = batch
                .into_iter()
                .filter(|l| !l.trim().is_empty())
                .map(slim)
                .collect();
            if !batch.is_empty() {
                let _ = on_output.send(AgentOutput::Lines { lines: batch });
            }
        }
        let code = child
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .try_wait()
            .ok()
            .flatten()
            .and_then(|s| s.code());
        app.state::<Agents>()
            .running
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&handle);
        let stderr = kept.lock().unwrap_or_else(|e| e.into_inner()).clone();
        let _ = on_output.send(AgentOutput::Exit { code, stderr });
    });
    Ok(handle)
}

/// How long lines are gathered before they go to the window together.
const GATHER: std::time::Duration = std::time::Duration::from_millis(24);
/// A line longer than this may carry a whole file or command output.
const SLIM_OVER: usize = 4096;
/// How much of a step's text the window keeps, as its step output shows.
const STEP_TEXT: usize = 4000;
/// What a step's update carries that the window never reads: the tool's raw
/// input and output (a whole written file, an edit's old and new text).
const UNREAD_STEP_FIELDS: [&str; 2] = ["rawInput", "rawOutput"];

/// `line` without what the window never reads of a step: its raw fields,
/// diff and terminal blocks, and text past what a step shows.
fn slim(line: String) -> String {
    if line.len() <= SLIM_OVER {
        return line;
    }
    let Ok(mut message) = serde_json::from_str::<Value>(&line) else {
        return line;
    };
    let step = matches!(
        message["params"]["update"]["sessionUpdate"].as_str(),
        Some("tool_call" | "tool_call_update")
    );
    if message["method"] != "session/update" || !step {
        return line;
    }
    let Some(fields) = message["params"]["update"].as_object_mut() else {
        return line;
    };
    for key in UNREAD_STEP_FIELDS {
        fields.remove(key);
    }
    if let Some(Value::Array(blocks)) = fields.get_mut("content") {
        blocks.retain(|b| b["type"] == "content");
        for block in blocks {
            if let Some(Value::String(text)) = block["content"].get_mut("text") {
                if let Some((cut, _)) = text.char_indices().nth(STEP_TEXT) {
                    text.truncate(cut);
                }
            }
        }
    }
    serde_json::to_string(&message).unwrap_or(line)
}

/// Writes one protocol message to agent `handle`.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn agent_send(app: tauri::AppHandle, handle: u64, line: String) -> Result<(), String> {
    let stdin = app
        .state::<Agents>()
        .running
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(&handle)
        .map(|r| r.stdin.clone())
        .ok_or("The agent has stopped.")?;
    let mut line = line.replace('\n', " ");
    line.push('\n');
    let mut stdin = stdin.lock().await;
    stdin
        .write_all(line.as_bytes())
        .await
        .map_err(|_| "The agent has stopped.".to_string())?;
    stdin
        .flush()
        .await
        .map_err(|_| "The agent has stopped.".to_string())
}

/// Ends every agent: a child process outlives the app that started it.
pub fn stop_all(app: &tauri::AppHandle) {
    stop_where(app, |_| true);
}

/// Ends the agents window `label` started, as it closes.
pub fn stop_for_window(app: &tauri::AppHandle, label: &str) {
    stop_where(app, |r| r.window == label);
}

fn stop_where(app: &tauri::AppHandle, matches: impl Fn(&Running) -> bool) {
    let agents = app.state::<Agents>();
    let stopped: Vec<Running> = {
        let mut running = agents.running.lock().unwrap_or_else(|e| e.into_inner());
        let handles: Vec<u64> = running
            .iter()
            .filter(|(_, r)| matches(r))
            .map(|(h, _)| *h)
            .collect();
        handles
            .into_iter()
            .filter_map(|h| running.remove(&h))
            .collect()
    };
    for r in stopped {
        let _ = r
            .child
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .start_kill();
    }
}

/// Ends agent `handle`, if it is still running.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn agent_stop(app: tauri::AppHandle, handle: u64) {
    let running = app
        .state::<Agents>()
        .running
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(&handle);
    if let Some(running) = running {
        let _ = running
            .child
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .start_kill();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_long_step_reaches_the_window_without_what_it_never_reads() {
        let long = "x".repeat(9000);
        let line = json!({"jsonrpc": "2.0", "method": "session/update", "params": {"update": {
            "sessionUpdate": "tool_call_update", "toolCallId": "t1", "status": "completed",
            "rawInput": {"content": long}, "rawOutput": long,
            "content": [
                {"type": "content", "content": {"type": "text", "text": long}},
                {"type": "diff", "path": "a.md", "oldText": long, "newText": long}
            ]
        }}})
        .to_string();
        let slimmed: Value = serde_json::from_str(&slim(line)).unwrap();
        let update = &slimmed["params"]["update"];
        assert!(update.get("rawInput").is_none() && update.get("rawOutput").is_none());
        assert_eq!(update["content"].as_array().unwrap().len(), 1);
        assert_eq!(
            update["content"][0]["content"]["text"]
                .as_str()
                .unwrap()
                .len(),
            STEP_TEXT
        );
        assert_eq!(update["toolCallId"], "t1");
        // A permission request keeps its step whole: the prompt shows it.
        let ask = json!({"jsonrpc": "2.0", "id": 3, "method": "session/request_permission",
            "params": {"toolCall": {"rawInput": {"command": long}}}})
        .to_string();
        assert_eq!(slim(ask.clone()), ask);
    }

    #[test]
    fn an_agent_starts_only_as_its_manifest_names_it() {
        let manifest = json!({"contributes": {"agents": [
            {"id": "fake", "command": "node", "args": ["{pluginDir}/agent.js", "--acp"],
             "env": {"HOME_HINT": "{pluginDir}"}},
            {"id": "empty", "command": " "}
        ]}});
        assert_eq!(
            launch(&manifest, "fake", "/p").unwrap(),
            Launch {
                command: "node".into(),
                args: vec!["/p/agent.js".into(), "--acp".into()],
                env: vec![("HOME_HINT".into(), "/p".into())],
            }
        );
        assert!(launch(&manifest, "empty", "/p").is_err());
        assert!(launch(&manifest, "missing", "/p").is_err());
    }
}
