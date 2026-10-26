//! MCP servers: programs or web services that give Textus AI more tools. Each
//! one turned on runs in the background; a request offers the tools of every
//! ready one. They come from settings.json's `mcpServers`.

mod client;
mod path;

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
const SERVERS_KEY: &str = "mcpServers";
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
    crate::settings::read_setting(app, SERVERS_KEY)
        .and_then(|v| serde_json::from_value::<Vec<ServerConfig>>(v).ok())
        .unwrap_or_default()
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
pub async fn mcp_try(server: Value) -> Result<Tried, String> {
    let config: ServerConfig = serde_json::from_value(server).map_err(|e| e.to_string())?;
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
    let mut text = if text.trim().is_empty() {
        "(The tool returned nothing.)".to_string()
    } else {
        text
    };
    if text.chars().count() > RESULT_CHARS {
        text = text.chars().take(RESULT_CHARS).collect::<String>()
            + "\n[cut off: the rest was too long]";
    }
    text.into()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A server in a few lines of Node: initialize, one tool that echoes,
    /// a ping of its own before answering tools/call.
    const ECHO_SERVER: &str = r#"
const rl = require("readline").createInterface({ input: process.stdin });
const send = (m) => process.stdout.write(JSON.stringify(m) + "\n");
rl.on("line", (line) => {
  const m = JSON.parse(line);
  if (m.method === "initialize")
    send({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "echo", version: "1.0" } } });
  else if (m.method === "tools/list")
    send({ jsonrpc: "2.0", id: m.id, result: { tools: [{ name: "echo", description: "Says it back.", inputSchema: { type: "object", properties: { text: { type: "string" } } } }] } });
  else if (m.method === "tools/call") {
    send({ jsonrpc: "2.0", id: 900, method: "ping" });
    send({ jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: "echo: " + m.params.arguments.text }] } });
  } else if (m.id === 900) process.stderr.write("pong\n");
});
"#;

    #[test]
    fn a_server_is_started_asked_for_its_tools_and_called() {
        let path = path::login_path();
        if path::find_program("node", &path).is_none() {
            eprintln!("no node - skipping");
            return;
        }
        let script =
            std::env::temp_dir().join(format!("textus-mcp-echo-{}.js", std::process::id()));
        std::fs::write(&script, ECHO_SERVER).unwrap();
        tauri::async_runtime::block_on(async {
            let connection = Connection::open(&Endpoint::Command {
                program: "node".into(),
                args: vec![script.to_string_lossy().to_string()],
                env: vec![],
            })
            .await
            .unwrap();
            assert_eq!(connection.server, "echo 1.0");
            let tools = connection.list_tools().await.unwrap();
            assert_eq!(tools[0].name, "echo");
            let tool = mcp_tool(
                "Echo",
                tool_name("Echo", "echo"),
                tools[0].clone(),
                Arc::new(connection),
            );
            assert_eq!(&*tool.spec.name, "mcp_echo_echo");
            let Run::Async(run) = tool.run else { panic!() };
            let out = run(ToolCall {
                call_id: "c".into(),
                name: "mcp_echo_echo".into(),
                arguments: r#"{"text":"hi"}"#.into(),
            })
            .await;
            assert_eq!(out.text, "echo: hi");
        });
        let _ = std::fs::remove_file(&script);
    }

    /// The official Memory server, fetched by npx: a real server's handshake, tool
    /// list and a call. Needs the network.
    #[test]
    #[ignore = "live: downloads @modelcontextprotocol/server-memory"]
    fn a_published_server_answers_as_ours_does() {
        tauri::async_runtime::block_on(async {
            let connection = Connection::open(&Endpoint::Command {
                program: "npx".into(),
                args: vec!["-y".into(), "@modelcontextprotocol/server-memory".into()],
                env: vec![(
                    "MEMORY_FILE_PATH".into(),
                    std::env::temp_dir()
                        .join(format!("textus-mcp-memory-{}.json", std::process::id()))
                        .to_string_lossy()
                        .to_string(),
                )],
            })
            .await
            .unwrap();
            let tools = connection.list_tools().await.unwrap();
            eprintln!(
                "{}: {:?}",
                connection.server,
                tools.iter().map(|t| &t.name).collect::<Vec<_>>()
            );
            assert!(tools.iter().any(|t| t.name == "read_graph"));
            let (text, failed) = connection.call_tool("read_graph", json!({})).await.unwrap();
            assert!(!failed, "{text}");
            assert!(text.contains("entities"), "{text}");
        });
    }

    #[test]
    fn a_command_not_installed_says_so() {
        let failed = tauri::async_runtime::block_on(Connection::open(&Endpoint::Command {
            program: "textus-no-such-server".into(),
            args: vec![],
            env: vec![],
        }));
        assert!(failed.err().is_some_and(|e| e.contains("isn't installed")));
    }

    #[test]
    fn a_tool_name_is_what_every_provider_takes() {
        assert_eq!(
            tool_name("File System", "read_file"),
            "mcp_file_system_read_file"
        );
        assert_eq!(tool_name("知识库", "search"), "mcp_search");
        assert!(tool_name(&"x".repeat(80), "y").len() <= 64);
    }

    #[test]
    fn a_server_is_a_command_or_a_url() {
        let config: ServerConfig = serde_json::from_value(json!({
            "id": "fs", "name": "Files", "enabled": true,
            "command": "npx", "args": ["-y", "server"], "env": {"B": "2", "A": "1"}
        }))
        .unwrap();
        assert_eq!(
            config.endpoint(),
            Some(Endpoint::Command {
                program: "npx".into(),
                args: vec!["-y".into(), "server".into()],
                env: vec![("A".into(), "1".into()), ("B".into(), "2".into())],
            })
        );
        let web: ServerConfig =
            serde_json::from_value(json!({"id": "w", "url": " https://x.test/mcp "})).unwrap();
        assert!(
            matches!(web.endpoint(), Some(Endpoint::Url { url, .. }) if url == "https://x.test/mcp")
        );
        let empty: ServerConfig = serde_json::from_value(json!({"id": "e"})).unwrap();
        assert_eq!(empty.endpoint(), None);
    }
}
