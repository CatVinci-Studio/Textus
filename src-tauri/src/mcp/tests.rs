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
    let script = std::env::temp_dir().join(format!("textus-mcp-echo-{}.js", std::process::id()));
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
