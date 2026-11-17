//! The app's own AI tools that run in the editor window, called as a
//! plugin's are (`app-ai-tools.ts` answers): Create mode's plugin check, and
//! what the folder's index knows - tasks, backlinks, tags - from the same
//! index plugins read.

use super::ai_tools::{call_tool, editor_window, trimmed, PluginAiTool};
use crate::ai::agent::AgentMode;
use crate::ai::tools::{Access, Run, Tool, EVERY_MODE};
use aicompat::agent::{ToolCall, ToolSpec};
use serde_json::{json, Value};
use tauri::AppHandle;

/// The owner a window tool's call names, where a plugin's names its id.
pub(super) const APP: &str = "textus";

/// The argument a folder tool's call carries the AI's folder in: the one
/// its other tools work in, which the sidebar's may not be.
const ROOT_ARG: &str = "__root";

/// One tool answered by `window`; `root`, the folder it reads, goes along.
fn window_tool<'a>(
    app: &AppHandle,
    window: &str,
    name: &'static str,
    description: &'static str,
    parameters: Value,
    modes: &'static [AgentMode],
    root: Option<String>,
) -> Tool<'a> {
    let (app, window) = (app.clone(), window.to_string());
    Tool {
        spec: ToolSpec {
            name: name.into(),
            description: description.into(),
            parameters,
        },
        access: Access::ReadOnly,
        modes,
        run: Run::Async(Box::new(move |call: ToolCall| {
            let (app, window, root) = (app.clone(), window.clone(), root.clone());
            Box::pin(async move {
                let tool = PluginAiTool {
                    plugin: APP.into(),
                    name: name.into(),
                    description: String::new(),
                    parameters: json!({}),
                };
                let mut arguments: Value =
                    serde_json::from_str(&call.arguments).unwrap_or_else(|_| json!({}));
                if let (Some(root), Some(args)) = (root, arguments.as_object_mut()) {
                    args.insert(ROOT_ARG.into(), Value::String(root));
                }
                let text = match call_tool(&app, &window, &tool, call.call_id, arguments).await {
                    Ok(text) | Err(text) => text,
                };
                trimmed(text).into()
            })
        })),
    }
}

/// Create mode's check of a plugin it wrote, by the rules install reads it
/// with (check-written-plugin.ts).
pub fn check_plugin_tool<'a>(app: &AppHandle, window: &str) -> Tool<'a> {
    window_tool(
        app,
        window,
        "check_plugin",
        "Checks a plugin you wrote before you give it to the user, as Textus will read it at install: the manifest, the `local.` id, the files `main` names, the permissions the code needs, commands and views declared but never registered, menu conditions Textus never sets. Pass every file of the plugin. Fix what it reports and check again until it reports nothing.",
        json!({
            "type": "object",
            "properties": {
                "files": {
                    "type": "array",
                    "description": "Every file of the plugin: textus-plugin.json, host.js and the rest.",
                    "items": {
                        "type": "object",
                        "properties": { "path": { "type": "string" }, "text": { "type": "string" } },
                        "required": ["path", "text"]
                    }
                }
            },
            "required": ["files"]
        }),
        &[AgentMode::Create],
        None,
    )
}

/// What the AI's folder's notes hold, read from its index: offered with a
/// folder for the AI.
pub fn folder_tools<'a>(app: &AppHandle, asking: &str, root: &str) -> Vec<Tool<'a>> {
    let window = &editor_window(app, asking);
    let root = Some(root.to_string());
    let path = |what: &str| json!({ "type": "string", "description": what });
    vec![
        window_tool(
            app,
            window,
            "list_tasks",
            "Lists the Markdown tasks (- [ ] ...) in the open folder's notes - open ones unless asked otherwise - each with its document path, line (from 1), due date and text. Filters by status, document, tag, due date and words.",
            json!({
                "type": "object",
                "properties": {
                    "status": { "type": "string", "enum": ["open", "done", "all"], "description": "Which tasks: open (the default), done or all." },
                    "path": path("Only this document's tasks: its path in the folder."),
                    "tag": path("Only tasks with this #tag."),
                    "due_before": path("Only tasks due on or before this date, YYYY-MM-DD."),
                    "query": path("Only tasks whose text holds these words."),
                    "limit": { "type": "integer", "description": "At most this many; 100 by default." }
                }
            }),
            EVERY_MODE,
            root.clone(),
        ),
        window_tool(
            app,
            window,
            "backlinks",
            "Lists the notes that link to a note, each with the line (from 1) and the link's text: what refers to it across the folder.",
            json!({
                "type": "object",
                "properties": { "path": path("The note's path in the folder, as find_files gives it.") },
                "required": ["path"]
            }),
            EVERY_MODE,
            root.clone(),
        ),
        window_tool(
            app,
            window,
            "list_tags",
            "Lists the #tags used in the open folder's notes (in the text and the front matter), the most used first, with how many notes use each.",
            json!({ "type": "object", "properties": {} }),
            EVERY_MODE,
            root.clone(),
        ),
        window_tool(
            app,
            window,
            "notes_with_tag",
            "Lists the notes that carry a #tag (nested tags under it too, as #project finds #project/alpha), with their titles.",
            json!({
                "type": "object",
                "properties": { "tag": path("The tag, with or without #.") },
                "required": ["tag"]
            }),
            EVERY_MODE,
            root.clone(),
        ),
    ]
}
