//! One connection to an MCP server: JSON-RPC 2.0 over a child process's
//! stdin and stdout (one message a line), or over Streamable HTTP (each
//! message POSTed, the answer as JSON or a short event stream). Only what
//! a client that calls tools needs: initialize, tools/list, tools/call -
//! and an answer to the server's ping.

use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::oneshot;

/// The protocol version asked for; a server answers with the one it
/// speaks, and every version since 2024-11-05 has the calls used here.
const PROTOCOL_VERSION: &str = "2025-06-18";
/// How long a server gets to start and answer initialize - npx may first
/// download the package.
pub const START_TIMEOUT: Duration = Duration::from_secs(90);
/// How long one tools/list or other short call may take.
const CALL_TIMEOUT: Duration = Duration::from_secs(30);
/// How long one tool may run.
pub const TOOL_TIMEOUT: Duration = Duration::from_secs(120);
/// The most of a server's stderr kept, to say why it failed.
const STDERR_KEEP: usize = 4_000;

/// One tool a server offers.
#[derive(Clone, Debug, serde::Serialize)]
#[cfg_attr(test, derive(specta::Type))]
pub struct McpTool {
    pub name: String,
    pub description: String,
    #[serde(rename = "inputSchema")]
    pub input_schema: Value,
}

type Waiting = Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>>;

type Stdin = Arc<tokio::sync::Mutex<tokio::process::ChildStdin>>;

/// A server started as a child process.
struct Stdio {
    child: Mutex<tokio::process::Child>,
    stdin: Stdin,
    waiting: Waiting,
    stderr: Arc<Mutex<String>>,
}

/// A server at a URL.
struct Http {
    client: reqwest::Client,
    url: String,
    headers: Vec<(String, String)>,
    session: Mutex<Option<String>>,
}

enum Transport {
    // Boxed: a Windows process handle makes it several times Http's size.
    Stdio(Box<Stdio>),
    Http(Http),
}

/// A connected, initialized server.
pub struct Connection {
    transport: Transport,
    next_id: AtomicU64,
    /// The name and version it gave.
    pub server: String,
}

/// How to reach a server: a command to start, or a URL.
#[derive(Clone, Debug, PartialEq)]
pub enum Endpoint {
    Command {
        program: String,
        args: Vec<String>,
        env: Vec<(String, String)>,
    },
    Url {
        url: String,
        headers: Vec<(String, String)>,
    },
}

impl Connection {
    /// Starts or reaches the server, and initializes it.
    pub async fn open(endpoint: &Endpoint) -> Result<Self, String> {
        let transport = match endpoint {
            Endpoint::Command { program, args, env } => {
                Transport::Stdio(Box::new(spawn(program, args, env)?))
            }
            Endpoint::Url { url, headers } => Transport::Http(Http {
                client: crate::net::client(Duration::from_secs(15), TOOL_TIMEOUT)
                    .build()
                    .map_err(|e| e.to_string())?,
                url: url.clone(),
                headers: headers.clone(),
                session: Mutex::new(None),
            }),
        };
        let mut connection = Self {
            transport,
            next_id: AtomicU64::new(1),
            server: String::new(),
        };
        let init = tokio::time::timeout(
            START_TIMEOUT,
            connection.request(
                "initialize",
                json!({
                    "protocolVersion": PROTOCOL_VERSION,
                    "capabilities": {},
                    "clientInfo": {"name": "Textus", "version": env!("CARGO_PKG_VERSION")},
                }),
                START_TIMEOUT,
            ),
        )
        .await
        .map_err(|_| connection.failure("it didn't answer within 90 seconds"))?
        .map_err(|e| connection.failure(&e))?;
        let info = &init["serverInfo"];
        connection.server = format!(
            "{} {}",
            info["name"].as_str().unwrap_or("MCP server"),
            info["version"].as_str().unwrap_or("")
        )
        .trim()
        .to_string();
        connection
            .notify("notifications/initialized", json!({}))
            .await?;
        Ok(connection)
    }

    /// Every tool the server offers, page by page.
    pub async fn list_tools(&self) -> Result<Vec<McpTool>, String> {
        let mut tools = Vec::new();
        let mut cursor: Option<String> = None;
        loop {
            let params = match &cursor {
                Some(c) => json!({ "cursor": c }),
                None => json!({}),
            };
            let page = self.request("tools/list", params, CALL_TIMEOUT).await?;
            for tool in page["tools"].as_array().into_iter().flatten() {
                let Some(name) = tool["name"].as_str() else {
                    continue;
                };
                tools.push(McpTool {
                    name: name.to_string(),
                    description: tool["description"].as_str().unwrap_or("").to_string(),
                    input_schema: match &tool["inputSchema"] {
                        Value::Object(_) => tool["inputSchema"].clone(),
                        _ => json!({"type": "object", "properties": {}}),
                    },
                });
            }
            match page["nextCursor"].as_str() {
                Some(next) if tools.len() < 500 => cursor = Some(next.to_string()),
                _ => break,
            }
        }
        Ok(tools)
    }

    /// Calls a tool: its result as the model reads it - its text, and a
    /// note for each picture or resource it sent - and whether the tool
    /// said it failed.
    pub async fn call_tool(&self, name: &str, arguments: Value) -> Result<(String, bool), String> {
        let result = self
            .request(
                "tools/call",
                json!({ "name": name, "arguments": arguments }),
                TOOL_TIMEOUT,
            )
            .await?;
        let mut parts = Vec::new();
        for item in result["content"].as_array().into_iter().flatten() {
            match item["type"].as_str() {
                Some("text") => parts.push(item["text"].as_str().unwrap_or("").to_string()),
                Some("image") => parts.push("[a picture]".to_string()),
                Some("audio") => parts.push("[a sound]".to_string()),
                Some("resource_link") | Some("resource") => parts.push(format!(
                    "[resource {}]",
                    item["uri"]
                        .as_str()
                        .or(item["resource"]["uri"].as_str())
                        .unwrap_or("")
                )),
                _ => {}
            }
        }
        if parts.is_empty() {
            if let Some(structured) = result.get("structuredContent") {
                parts.push(structured.to_string());
            }
        }
        Ok((parts.join("\n"), result["isError"].as_bool() == Some(true)))
    }

    /// Why the server failed, with what it wrote to stderr.
    fn failure(&self, why: &str) -> String {
        match &self.transport {
            Transport::Stdio(stdio) => {
                let stderr = stdio.stderr.lock().unwrap_or_else(|e| e.into_inner());
                let tail = stderr.trim();
                if tail.is_empty() {
                    why.to_string()
                } else {
                    format!("{why}. It said: {tail}")
                }
            }
            Transport::Http(_) => why.to_string(),
        }
    }

    async fn request(
        &self,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let message = json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params});
        match &self.transport {
            Transport::Stdio(stdio) => {
                let (send, answer) = oneshot::channel();
                stdio
                    .waiting
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .insert(id, send);
                stdio.write(&message).await.map_err(|e| self.failure(&e))?;
                match tokio::time::timeout(timeout, answer).await {
                    Ok(Ok(result)) => result,
                    Ok(Err(_)) => Err(self.failure("the server stopped")),
                    Err(_) => {
                        stdio
                            .waiting
                            .lock()
                            .unwrap_or_else(|e| e.into_inner())
                            .remove(&id);
                        Err(format!("{method} took longer than {} s", timeout.as_secs()))
                    }
                }
            }
            Transport::Http(http) => http.post(&message, Some(id)).await,
        }
    }

    async fn notify(&self, method: &str, params: Value) -> Result<(), String> {
        let message = json!({"jsonrpc": "2.0", "method": method, "params": params});
        match &self.transport {
            Transport::Stdio(stdio) => stdio.write(&message).await.map_err(|e| self.failure(&e)),
            Transport::Http(http) => http.post(&message, None).await.map(|_| ()),
        }
    }

    /// Whether a started server's process is still running.
    pub fn alive(&self) -> bool {
        match &self.transport {
            Transport::Stdio(stdio) => matches!(
                stdio
                    .child
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .try_wait(),
                Ok(None)
            ),
            Transport::Http(_) => true,
        }
    }
}

/// Starts `program`, found on the user's login PATH, and reads its answers.
fn spawn(program: &str, args: &[String], env: &[(String, String)]) -> Result<Stdio, String> {
    let path = super::path::login_path();
    let resolved = super::path::find_program(program, &path).ok_or_else(|| {
        format!("`{program}` isn't installed, or isn't on the PATH Textus sees ({path})")
    })?;
    let mut command = tokio::process::Command::new(resolved);
    command
        .args(args)
        .env("PATH", &path)
        .envs(env.iter().map(|(k, v)| (k.as_str(), v.as_str())))
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    {
        // No console window flashing up for the server.
        command.creation_flags(0x0800_0000);
    }
    let mut child = command
        .spawn()
        .map_err(|e| format!("couldn't start `{program}`: {e}"))?;
    let stdin = child.stdin.take().ok_or("no stdin")?;
    let stdout = child.stdout.take().ok_or("no stdout")?;
    let stderr = child.stderr.take().ok_or("no stderr")?;
    let waiting: Waiting = Arc::default();
    let kept_stderr: Arc<Mutex<String>> = Arc::default();
    let stdin: Stdin = Arc::new(tokio::sync::Mutex::new(stdin));
    let stdio = Stdio {
        child: Mutex::new(child),
        stdin: stdin.clone(),
        waiting: waiting.clone(),
        stderr: kept_stderr.clone(),
    };
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let mut kept = kept_stderr.lock().unwrap_or_else(|e| e.into_inner());
            kept.push_str(&line);
            kept.push('\n');
            if kept.len() > STDERR_KEEP {
                let cut = kept.len() - STDERR_KEEP;
                let cut = (cut..kept.len())
                    .find(|i| kept.is_char_boundary(*i))
                    .unwrap_or(0);
                kept.replace_range(..cut, "");
            }
        }
    });
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let Ok(message) = serde_json::from_str::<Value>(line.trim()) else {
                continue;
            };
            if let Some(reply) = dispatch(&waiting, message) {
                let _ = write_line(&stdin, &reply).await;
            }
        }
        // The server is gone: every call still waiting fails.
        waiting.lock().unwrap_or_else(|e| e.into_inner()).clear();
    });
    Ok(stdio)
}

/// A message from the server: the answer to one of ours goes to its
/// caller; a request of its own gets the reply returned - ping answered,
/// anything else (sampling, roots) not offered by this client refused. A
/// notification (logging, progress) needs nothing.
fn dispatch(waiting: &Waiting, message: Value) -> Option<Value> {
    if let Some(method) = message["method"].as_str() {
        let id = message.get("id")?.clone();
        return Some(if method == "ping" {
            json!({"jsonrpc": "2.0", "id": id, "result": {}})
        } else {
            json!({"jsonrpc": "2.0", "id": id, "error": {"code": -32601, "message": "Not offered by Textus"}})
        });
    }
    let id = message["id"].as_u64()?;
    let send = waiting
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(&id)?;
    let result = match message.get("error") {
        Some(error) => Err(error["message"]
            .as_str()
            .unwrap_or("the server refused")
            .to_string()),
        None => Ok(message.get("result").cloned().unwrap_or(Value::Null)),
    };
    let _ = send.send(result);
    None
}

/// Writes one message as a line.
async fn write_line(stdin: &Stdin, message: &Value) -> Result<(), String> {
    let mut line = message.to_string();
    line.push('\n');
    let mut stdin = stdin.lock().await;
    stdin
        .write_all(line.as_bytes())
        .await
        .map_err(|_| "the server stopped".to_string())?;
    stdin
        .flush()
        .await
        .map_err(|_| "the server stopped".to_string())
}

impl Stdio {
    async fn write(&self, message: &Value) -> Result<(), String> {
        write_line(&self.stdin, message).await
    }
}

impl Http {
    /// POSTs one message; the answer to `id`, read from JSON or from an
    /// event stream.
    async fn post(&self, message: &Value, id: Option<u64>) -> Result<Value, String> {
        let mut request = self
            .client
            .post(&self.url)
            .header("Accept", "application/json, text/event-stream")
            .header("MCP-Protocol-Version", PROTOCOL_VERSION)
            .json(message);
        for (name, value) in &self.headers {
            request = request.header(name, value);
        }
        if let Some(session) = self
            .session
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
        {
            request = request.header("Mcp-Session-Id", session);
        }
        let response = request.send().await.map_err(|e| e.to_string())?;
        if let Some(session) = response
            .headers()
            .get("mcp-session-id")
            .and_then(|v| v.to_str().ok())
        {
            *self.session.lock().unwrap_or_else(|e| e.into_inner()) = Some(session.to_string());
        }
        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(format!(
                "the server answered {status}: {}",
                body.chars().take(300).collect::<String>()
            ));
        }
        let Some(id) = id else {
            return Ok(Value::Null);
        };
        let streamed = response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .is_some_and(|t| t.starts_with("text/event-stream"));
        let body = crate::net::read_limited(response, 16 * 1024 * 1024)
            .await?
            .ok_or("the answer was over 16 MB")?;
        let body = String::from_utf8_lossy(&body);
        let answer = if streamed {
            body.lines()
                .filter_map(|line| line.strip_prefix("data:"))
                .filter_map(|data| serde_json::from_str::<Value>(data.trim()).ok())
                .find(|m| m["id"].as_u64() == Some(id))
                .ok_or("the event stream had no answer")?
        } else {
            serde_json::from_str::<Value>(&body)
                .map_err(|_| "the answer wasn't JSON".to_string())?
        };
        match answer.get("error") {
            Some(error) => Err(error["message"]
                .as_str()
                .unwrap_or("the server refused")
                .to_string()),
            None => Ok(answer.get("result").cloned().unwrap_or(Value::Null)),
        }
    }
}
