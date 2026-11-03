//! The running app's side of `textus`: a listener started in setup that
//! answers plugin tools and skills itself and hands the rest (commands,
//! plugins, themes, export) to a window, which answers with `cli_respond`.

use super::ipc::{self, Answer, Request};
use super::tool_args::{self, LIST_TOOLS, PLUGIN_PREFIX};
use crate::plugins::ai_tools::{call_tool, offered_tools, short_name, PluginAiTool};
use serde::Serialize;
use serde_json::json;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::oneshot;

/// How long a window may take: turning a plugin on waits for the user to
/// grant its permissions.
const WINDOW_ANSWERS_WITHIN: Duration = Duration::from_secs(600);
/// How long a window has to open and start listening.
const WINDOW_READY_WITHIN: Duration = Duration::from_secs(30);

/// How long the export has to reach its save dialog.
const EXPORT_STARTS_WITHIN: Duration = Duration::from_secs(30);

/// `--to` formats: the name, the file's extension and the menu item that
/// exports it (menu.rs's export ids).
const EXPORT_FORMATS: &[(&str, &str)] = &[
    ("pdf", "pdf"),
    ("html", "html"),
    ("docx", "docx"),
    ("odt", "odt"),
    ("rtf", "rtf"),
    ("epub", "epub"),
    ("latex", "tex"),
    ("mediawiki", "wiki"),
    ("rst", "rst"),
    ("textile", "textile"),
    ("opml", "opml"),
];

#[derive(Default)]
pub struct CliBridge {
    /// Windows whose frontend takes requests, by label.
    listening: Mutex<Vec<String>>,
    waiting: Mutex<HashMap<String, oneshot::Sender<Answer>>>,
}

/// A request for a window. Shape shared with src/app/cli-requests.ts.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CliRequestEvent {
    id: String,
    command: String,
    args: Vec<String>,
    cwd: String,
    json: bool,
}

/// A window's frontend starts (`on`) or stops taking requests.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn cli_listening(app: AppHandle, window: tauri::Window, on: bool) {
    let bridge = app.state::<CliBridge>();
    let mut listening = bridge.listening.lock().unwrap_or_else(|e| e.into_inner());
    listening.retain(|label| label != window.label());
    if on {
        listening.push(window.label().to_string());
    }
}

/// A window's answer to request `id`.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn cli_respond(app: AppHandle, id: String, out: String, err: String, exit: i32) {
    let bridge = app.state::<CliBridge>();
    let sender = bridge
        .waiting
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(&id);
    if let Some(sender) = sender {
        let _ = sender.send(Answer { out, err, exit });
    }
}

pub fn start(app: &AppHandle) {
    tauri::async_runtime::spawn(listen(app.clone()));
}

#[cfg(unix)]
async fn listen(app: AppHandle) {
    use std::os::unix::fs::{MetadataExt, PermissionsExt};
    let Some(path) = ipc::endpoint() else { return };
    // Another Textus (a dev build beside an installed one) answers already.
    if std::os::unix::net::UnixStream::connect(&path).is_ok() {
        return;
    }
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
        let _ = std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700));
    }
    let _ = std::fs::remove_file(&path);
    let Ok(listener) = tokio::net::UnixListener::bind(&path) else {
        return;
    };
    let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    let Ok(owner) = std::fs::metadata(&path).map(|m| m.uid()) else {
        return;
    };
    loop {
        let Ok((stream, _)) = listener.accept().await else {
            continue;
        };
        if stream.peer_cred().ok().map(|c| c.uid()) != Some(owner) {
            continue;
        }
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let _ = ipc::serve(stream, |request| handle(app, request)).await;
        });
    }
}

#[cfg(windows)]
async fn listen(app: AppHandle) {
    use tokio::net::windows::named_pipe::ServerOptions;
    let Some(name) = ipc::endpoint() else { return };
    let create = |first: bool| {
        ServerOptions::new()
            .first_pipe_instance(first)
            .reject_remote_clients(true)
            .create(&name)
    };
    // Fails when another Textus has the pipe already.
    let Ok(mut server) = create(true) else { return };
    loop {
        if server.connect().await.is_err() {
            let Ok(next) = create(false) else { return };
            server = next;
            continue;
        }
        let Ok(next) = create(false) else { return };
        let connected = std::mem::replace(&mut server, next);
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let _ = ipc::serve(connected, |request| handle(app, request)).await;
        });
    }
}

async fn handle(app: AppHandle, request: Request) -> Answer {
    if request.command == LIST_TOOLS {
        return Answer::ok(tool_lines(&tools(&app)));
    }
    if let Some(word) = request.command.strip_prefix(PLUGIN_PREFIX) {
        return plugin_tool(&app, word, &request.args).await;
    }
    match request.command.as_str() {
        "skill" => skills(&app, &request).await,
        "export" => export(&app, request).await,
        "commands" | "plugin" | "theme" => in_window(&app, request).await,
        other => Answer::fail(format!("'{other}' is not a textus command."), 2),
    }
}

/// Each plugin tool once, though every window offers its plugins' tools.
fn tools(app: &AppHandle) -> Vec<(String, PluginAiTool)> {
    let mut seen = Vec::new();
    let mut tools = offered_tools(app);
    tools.retain(|(_, t)| {
        let key = (t.plugin.clone(), t.name.clone());
        let new = !seen.contains(&key);
        seen.push(key);
        new
    });
    tools.sort_by(|a, b| (&a.1.plugin, &a.1.name).cmp(&(&b.1.plugin, &b.1.name)));
    tools
}

/// `textus help`'s plugin lines: `  word-count count   Counts words.`
pub(super) fn tool_lines(tools: &[(String, PluginAiTool)]) -> String {
    let names: Vec<String> = tools
        .iter()
        .map(|(_, t)| format!("{} {}", short_name(&t.plugin), t.name))
        .collect();
    let width = names.iter().map(String::len).max().unwrap_or(0);
    names
        .iter()
        .zip(tools)
        .map(|(name, (_, t))| {
            let summary = t.description.lines().next().unwrap_or_default();
            format!("  {name:width$}  {summary}\n")
        })
        .collect()
}

static CALLS: AtomicU64 = AtomicU64::new(0);

async fn plugin_tool(app: &AppHandle, word: &str, args: &[String]) -> Answer {
    let tools: Vec<_> = tools(app)
        .into_iter()
        .filter(|(_, t)| short_name(&t.plugin) == word)
        .collect();
    if tools.is_empty() {
        return Answer::fail(
            format!("'{word}' is not a textus command or a plugin's. See 'textus help'."),
            2,
        );
    }
    let help = args.iter().any(|a| a == "--help" || a == "-h");
    let Some((window, tool)) = args
        .first()
        .and_then(|name| tools.iter().find(|(_, t)| &t.name == name))
    else {
        let list = format!(
            "Usage: textus {word} <tool>\n\nTools:\n{}",
            tool_lines(&tools)
        );
        return if help {
            Answer::ok(list)
        } else {
            Answer::fail(list, 2)
        };
    };
    if help {
        return Answer::ok(tool_args::usage(
            &tool.plugin,
            &tool.name,
            &tool.description,
            &tool.parameters,
        ));
    }
    let arguments = match tool_args::arguments(&tool.parameters, &args[1..]) {
        Ok(arguments) => arguments,
        Err(why) => {
            return Answer::fail(
                format!("{why} See 'textus {word} {} --help'.", tool.name),
                2,
            )
        }
    };
    let id = format!("cli-{}", CALLS.fetch_add(1, Ordering::Relaxed));
    match call_tool(app, window, tool, id, arguments).await {
        Ok(text) => Answer::ok(text),
        Err(why) => Answer::fail(why, 1),
    }
}

async fn skills(app: &AppHandle, request: &Request) -> Answer {
    if request.args.iter().map(String::as_str).ne(["list"]) {
        return Answer::fail("Usage: textus skill list", 2);
    }
    let skills = crate::ai::workspace::list_skills(app.clone(), None, None).await;
    if request.json {
        let list: Vec<_> = skills
            .iter()
            .map(|s| json!({ "name": s.name, "description": s.description, "off": s.off }))
            .collect();
        return Answer::ok(json!(list).to_string());
    }
    let width = skills.iter().map(|s| s.name.len()).max().unwrap_or(0);
    Answer::ok(
        skills
            .iter()
            .map(|s| {
                let off = if s.off { " (off)" } else { "" };
                let line = s.description.lines().next().unwrap_or_default();
                format!("{:width$}  {line}{off}\n", s.name)
            })
            .collect::<String>(),
    )
}

/// Hands the request to a window and waits for its answer.
async fn in_window(app: &AppHandle, request: Request) -> Answer {
    let Some(window) = listening_window(app).await else {
        return Answer::fail("No Textus window could take the command.", 1);
    };
    let id = format!("cli-{}", CALLS.fetch_add(1, Ordering::Relaxed));
    let (send, answer) = oneshot::channel();
    let bridge = app.state::<CliBridge>();
    let waiting = || bridge.waiting.lock().unwrap_or_else(|e| e.into_inner());
    waiting().insert(id.clone(), send);
    let event = CliRequestEvent {
        id: id.clone(),
        command: request.command,
        args: request.args,
        cwd: request.cwd,
        json: request.json,
    };
    if app.emit_to(&window, "cli-request", event).is_err() {
        waiting().remove(&id);
        return Answer::fail("The Textus window closed.", 1);
    }
    match tokio::time::timeout(WINDOW_ANSWERS_WITHIN, answer).await {
        Ok(Ok(answer)) => answer,
        _ => {
            waiting().remove(&id);
            Answer::fail("Textus didn't answer in time.", 1)
        }
    }
}

/// The focused window that takes requests, else any; with none open (macOS
/// keeps running windowless) a new one, once it listens.
async fn listening_window(app: &AppHandle) -> Option<String> {
    let deadline = Instant::now() + WINDOW_READY_WITHIN;
    let mut opened = false;
    loop {
        let windows = app.webview_windows();
        let listening: Vec<String> = app
            .state::<CliBridge>()
            .listening
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .iter()
            .filter(|label| windows.contains_key(*label))
            .cloned()
            .collect();
        let focused = crate::menu::focused_editor_window(app).filter(|l| listening.contains(l));
        if let Some(label) = focused.or_else(|| listening.first().cloned()) {
            return Some(label);
        }
        let any_editor = windows
            .keys()
            .any(|label| crate::commands::chat_window::is_editor_window(label));
        if !opened && !any_editor {
            let _ = crate::editor_windows::open_new_window(app);
            opened = true;
        }
        if Instant::now() > deadline {
            return None;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

/// Opens the document in a window and runs its export there; the export's
/// save dialog takes the target without asking (commands/export.rs).
async fn export(app: &AppHandle, request: Request) -> Answer {
    let job = match export_job(&request) {
        Ok(job) => job,
        Err(why) => return Answer::fail(why, 2),
    };
    let pandoc = !matches!(job.format, "pdf" | "html");
    if pandoc && crate::commands::export::detect_pandoc().await.is_none() {
        return Answer::fail(
            format!(
                "Exporting to {} needs pandoc: https://pandoc.org/installing.html",
                job.format
            ),
            1,
        );
    }
    let target = job.out.to_string_lossy().into_owned();
    crate::commands::export::set_cli_export_target(Some(target.clone()));
    let menu_id = if pandoc {
        format!("export-pandoc:{}", job.format)
    } else {
        format!("export-{}", job.format)
    };
    let opened = in_window(
        app,
        Request {
            command: "export".into(),
            args: vec![job.file.to_string_lossy().into_owned(), menu_id],
            ..request
        },
    )
    .await;
    let answer = if opened.exit != 0 {
        opened
    } else if written(&job.out).await {
        Answer::ok(target)
    } else {
        Answer::fail(
            "The export didn't finish; Textus says why in its window.",
            1,
        )
    };
    crate::commands::export::set_cli_export_target(None);
    answer
}

#[derive(Debug)]
pub(super) struct ExportJob {
    file: PathBuf,
    format: &'static str,
    pub(super) out: PathBuf,
}

/// `export <file> --to <format> [--out <file>]`, checked.
pub(super) fn export_job(request: &Request) -> Result<ExportJob, String> {
    let mut args = request.args.clone();
    let to = super::take_option(&mut args, "--to")?;
    let out = super::take_option(&mut args, "--out")?;
    let [file] = args.as_slice() else {
        return Err("Usage: textus export <file> --to <format> [--out <file>]".into());
    };
    let cwd = Path::new(&request.cwd);
    let file = cwd.join(file);
    if !file.is_file() {
        return Err(format!("{} isn't a file.", file.display()));
    }
    let to = to.ok_or("Say which format with --to (pdf, html, docx, ...).")?;
    let &(format, ext) = EXPORT_FORMATS
        .iter()
        .find(|(name, _)| *name == to)
        .ok_or_else(|| format!("Textus doesn't export to '{to}'. See 'textus help export'."))?;
    let out = match out {
        Some(out) => cwd.join(out),
        None => file.with_extension(ext),
    };
    if out.exists() {
        return Err(format!(
            "{} is already there; choose another with --out.",
            out.display()
        ));
    }
    Ok(ExportJob { file, format, out })
}

/// Whether the export wrote `out`: there, and the same size twice in a row.
/// An export that never asked where to save failed before it began.
async fn written(out: &Path) -> bool {
    let started = Instant::now();
    let mut last = None;
    while started.elapsed() < WINDOW_ANSWERS_WITHIN {
        if started.elapsed() > EXPORT_STARTS_WITHIN && !crate::commands::export::cli_export_taken()
        {
            return false;
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
        let size = std::fs::metadata(out)
            .ok()
            .map(|m| m.len())
            .filter(|&n| n > 0);
        if size.is_some() && size == last {
            return true;
        }
        last = size;
    }
    false
}
