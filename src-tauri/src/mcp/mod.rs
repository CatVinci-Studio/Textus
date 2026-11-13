//! MCP servers: programs or web services that give Textus AI more tools. Each
//! one turned on runs in the background; a request offers the tools of every
//! ready one. They come from settings.json's `mcpServers`.

mod client;
pub(crate) mod path;
pub(crate) mod process;
pub(crate) mod secrets;

pub use client::{Connection, Endpoint, McpTool};

use crate::ai::tools::{Access, Run, Tool, EVERY_MODE};
use aicompat::agent::{ToolCall, ToolOutput, ToolSpec};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tokio::sync::watch;

/// The settings.json field listing the servers.
pub(crate) const SERVERS_KEY: &str = "mcpServers";
/// How long a request waits for a server still starting.
const WAIT_FOR_START: Duration = Duration::from_secs(10);
/// The most of one tool's answer the model is given.
const RESULT_CHARS: usize = 30_000;

/// One server as Settings keeps it.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ServerConfig {
    id: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    enabled: bool,
    #[serde(default)]
    command: String,
    #[serde(default)]
    args: Vec<String>,
    #[serde(default)]
    env: HashMap<String, String>,
    #[serde(default)]
    url: String,
    #[serde(default)]
    headers: HashMap<String, String>,
}

impl ServerConfig {
    /// Its secrets as kept, where the settings say MASK.
    fn unmask(&mut self, app: &AppHandle) {
        secrets::unmask(app, &self.id, &mut self.env, &mut self.headers);
    }

    fn endpoint(&self) -> Option<Endpoint> {
        let pairs = |map: &HashMap<String, String>| {
            let mut pairs: Vec<(String, String)> =
                map.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
            pairs.sort();
            pairs
        };
        if !self.url.trim().is_empty() {
            return Some(Endpoint::Url {
                url: self.url.trim().to_string(),
                headers: pairs(&self.headers),
            });
        }
        (!self.command.trim().is_empty()).then(|| Endpoint::Command {
            program: self.command.trim().to_string(),
            args: self.args.clone(),
            env: pairs(&self.env),
        })
    }

    fn label(&self) -> &str {
        if self.name.trim().is_empty() {
            &self.id
        } else {
            self.name.trim()
        }
    }
}

/// A started server, once it has answered: its connection and tools, or
/// why it couldn't start.
#[derive(Clone)]
enum Started {
    Ready {
        connection: Arc<Connection>,
        tools: Vec<McpTool>,
    },
    Failed(String),
}

struct Running {
    endpoint: Endpoint,
    name: String,
    state: watch::Receiver<Option<Started>>,
}

/// The servers running, by id (app state).
#[derive(Default)]
pub struct McpHub {
    running: tokio::sync::Mutex<HashMap<String, Running>>,
}

fn configs(app: &AppHandle) -> Vec<ServerConfig> {
    let mut configs: Vec<ServerConfig> = crate::settings::read_setting(app, SERVERS_KEY)
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default();
    for config in &mut configs {
        config.unmask(app);
    }
    configs
}

impl McpHub {
    /// Brings the running servers in line with the settings: each one on is
    /// started (again, if changed or stopped), each one off or gone is stopped.
    async fn sync(&self, app: &AppHandle) {
        let wanted: Vec<(ServerConfig, Endpoint)> = configs(app)
            .into_iter()
            .filter(|c| c.enabled)
            .filter_map(|c| c.endpoint().map(|e| (c, e)))
            .collect();
        let mut running = self.running.lock().await;
        running.retain(|id, server| {
            wanted
                .iter()
                .any(|(c, e)| &c.id == id && *e == server.endpoint && !server.stopped())
        });
        for (config, endpoint) in wanted {
            if running.contains_key(&config.id) {
                if let Some(server) = running.get_mut(&config.id) {
                    server.name = config.label().to_string();
                }
                continue;
            }
            running.insert(config.id.clone(), start(config.label(), endpoint));
        }
    }

    /// Stops a server and starts it again.
    async fn restart(&self, app: &AppHandle, id: &str) {
        self.running.lock().await.remove(id);
        self.sync(app).await;
    }
}

impl Running {
    /// Whether it started and then stopped (its process gone).
    fn stopped(&self) -> bool {
        match &*self.state.borrow() {
            Some(Started::Ready { connection, .. }) => !connection.alive(),
            _ => false,
        }
    }
}

/// Starts a server in the background.
fn start(name: &str, endpoint: Endpoint) -> Running {
    let (send, state) = watch::channel(None);
    let opening = endpoint.clone();
    tauri::async_runtime::spawn(async move {
        let started = match Connection::open(&opening).await {
            Ok(connection) => match connection.list_tools().await {
                Ok(tools) => Started::Ready {
                    connection: Arc::new(connection),
                    tools,
                },
                Err(why) => Started::Failed(why),
            },
            Err(why) => Started::Failed(why),
        };
        let _ = send.send(Some(started));
    });
    Running {
        endpoint,
        name: name.to_string(),
        state,
    }
}

/// A server's state as Settings shows it.
#[derive(Serialize)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ServerStatus {
    id: String,
    /// "starting", "ready" or "failed".
    state: &'static str,
    server: String,
    tools: Vec<McpTool>,
    error: Option<String>,
}

fn status_of(id: &str, server: &Running) -> ServerStatus {
    let (state, name, tools, error) = match &*server.state.borrow() {
        None => ("starting", String::new(), Vec::new(), None),
        Some(Started::Ready { connection, tools }) => {
            ("ready", connection.server.clone(), tools.clone(), None)
        }
        Some(Started::Failed(why)) => ("failed", String::new(), Vec::new(), Some(why.clone())),
    };
    ServerStatus {
        id: id.to_string(),
        state,
        server: name,
        tools,
        error,
    }
}

/// The servers that are on, each starting, ready or failed.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn mcp_status(app: AppHandle) -> Vec<ServerStatus> {
    let hub = app.state::<McpHub>();
    hub.sync(&app).await;
    let running = hub.running.lock().await;
    let mut list: Vec<ServerStatus> = running.iter().map(|(id, s)| status_of(id, s)).collect();
    list.sort_by(|a, b| a.id.cmp(&b.id));
    list
}

#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn mcp_restart(app: AppHandle, id: String) -> Vec<ServerStatus> {
    app.state::<McpHub>().restart(&app, &id).await;
    mcp_status(app).await
}

/// What a server offers, tried before it is saved: its name and tools, or why
/// it can't be reached.
#[derive(Serialize)]
#[cfg_attr(test, derive(specta::Type))]
pub struct Tried {
    server: String,
    tools: Vec<McpTool>,
}

#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn mcp_try(app: AppHandle, server: Value) -> Result<Tried, String> {
    let mut config: ServerConfig = serde_json::from_value(server).map_err(|e| e.to_string())?;
    config.unmask(&app);
    let endpoint = config.endpoint().ok_or("Give a command or a URL.")?;
    let connection = Connection::open(&endpoint).await?;
    let tools = connection.list_tools().await?;
    Ok(Tried {
        server: connection.server.clone(),
        tools,
    })
}

/// A tool's name as the model sees it: mcp_<server>_<tool>, in the
/// letters, digits, `_` and `-` every provider takes, at most 64 long.
fn tool_name(server: &str, tool: &str) -> String {
    let clean = |s: &str| -> String {
        s.chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() || c == '-' {
                    c.to_ascii_lowercase()
                } else {
                    '_'
                }
            })
            .collect::<String>()
            .trim_matches('_')
            .to_string()
    };
    let parts = ["mcp".to_string(), clean(server), clean(tool)];
    let mut name = parts
        .iter()
        .filter(|p| !p.is_empty())
        .cloned()
        .collect::<Vec<_>>()
        .join("_");
    name.truncate(64);
    name
}

/// The tools of every server ready for this request, waiting a little for
/// one still starting.
pub async fn tools_for_request<'a>(app: &AppHandle) -> Vec<Tool<'a>> {
    let hub = app.state::<McpHub>();
    hub.sync(app).await;
    let servers: Vec<(String, watch::Receiver<Option<Started>>)> = hub
        .running
        .lock()
        .await
        .values()
        .map(|s| (s.name.clone(), s.state.clone()))
        .collect();
    let mut tools = Vec::new();
    let mut taken: Vec<String> = Vec::new();
    for (name, mut state) in servers {
        let _ = tokio::time::timeout(WAIT_FOR_START, state.wait_for(|s| s.is_some())).await;
        let Some(Started::Ready {
            connection,
            tools: offered,
        }) = state.borrow().clone()
        else {
            continue;
        };
        for tool in offered {
            let mut model_name = tool_name(&name, &tool.name);
            while taken.contains(&model_name) {
                model_name.push('_');
            }
            taken.push(model_name.clone());
            tools.push(mcp_tool(&name, model_name, tool, connection.clone()));
        }
    }
    tools
}

fn mcp_tool<'a>(
    server: &str,
    model_name: String,
    tool: McpTool,
    connection: Arc<Connection>,
) -> Tool<'a> {
    let mut parameters = tool.input_schema.clone();
    if parameters.get("properties").is_none() {
        parameters["properties"] = json!({});
    }
    let description = if tool.description.trim().is_empty() {
        format!(
            "{} (a tool of the MCP server {server}, which the user connected).",
            tool.name
        )
    } else {
        format!(
            "{}\n\n(A tool of the MCP server {server}, which the user connected.)",
            tool.description.trim()
        )
    };
    let original = tool.name.clone();
    Tool {
        spec: ToolSpec {
            name: model_name.into(),
            description: description.into(),
            parameters,
        },
        // A server's tool may change things outside Textus: one call at a
        // time, in the order asked.
        access: Access::Proposes,
        modes: EVERY_MODE,
        run: Run::Async(Box::new(move |call: ToolCall| {
            let connection = connection.clone();
            let original = original.clone();
            Box::pin(async move { run_call(&connection, &original, &call.arguments).await })
        })),
    }
}

async fn run_call(connection: &Connection, tool: &str, arguments: &str) -> ToolOutput {
    let arguments: Value = serde_json::from_str(arguments).unwrap_or_else(|_| json!({}));
    let text = match connection.call_tool(tool, arguments).await {
        Ok((text, false)) => text,
        Ok((text, true)) => format!("The tool reported an error: {text}"),
        Err(why) => format!("The MCP server couldn't run it: {why}"),
    };
    crate::ai::outside_tool_result(text, RESULT_CHARS).into()
}

#[cfg(test)]
mod tests;
