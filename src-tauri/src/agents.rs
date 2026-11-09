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
    /// One line of its stdout: a protocol message.
    Line { text: String },
    /// It ended; the end of its stderr says why.
    Exit { code: Option<i32>, stderr: String },
}

type Stdin = Arc<tokio::sync::Mutex<tokio::process::ChildStdin>>;

struct Running {
    stdin: Stdin,
    child: Arc<Mutex<tokio::process::Child>>,
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
            },
        );
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if !line.trim().is_empty() {
                let _ = on_output.send(AgentOutput::Line { text: line });
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
    let running: Vec<Running> = app
        .state::<Agents>()
        .running
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .drain()
        .map(|(_, r)| r)
        .collect();
    for r in running {
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
