// Tasks: every Markdown task in the open folder's documents - "- [ ] …" and
// "- [x] …" - gathered into the sidebar, by document, under the heading
// each sits beneath. Ticking one writes that one line of its file, after
// checking the line still says what was listed.
let panel = null;

const TASK = /^(\s*(?:[-*+]|\d+[.)])\s+\[)( |x|X)(\]\s+)(.*)$/;
const HEADING = /^#{1,6}\s+(.*?)\s*#*\s*$/;

/** The tasks of one document's text, with the line each is on. */
function tasksIn(text) {
  const out = [];
  let heading = null;
  let fenced = false;
  text.split("\n").forEach(function (line, index) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (fenced) return;
    const h = HEADING.exec(line);
    if (h) heading = h[1];
    const m = TASK.exec(line);
    if (m) out.push({ line: index, done: m[2] !== " ", text: m[4].trim(), heading: heading });
  });
  return out;
}

async function scan() {
  const root = await textus.workspace.rootPath();
  if (!root) return null;
  const docs = await textus.workspace.findDocuments();
  const files = [];
  for (const doc of docs) {
    if (!/\.(md|markdown)$/i.test(doc.path)) continue;
    try {
      const tasks = tasksIn(await textus.workspace.readText(doc.path));
      if (tasks.length) files.push({ path: doc.path, rel: doc.rel, tasks: tasks });
    } catch (err) {
      // Unreadable: left out.
    }
  }
  return files;
}

let scanning = null;
async function refresh() {
  if (!panel) return;
  // One scan at a time; one asked for meanwhile runs after.
  if (scanning) return void scanning.then(refresh);
  scanning = (async function () {
    const files = await scan();
    if (panel)
      panel.postMessage({ type: "tasks", files: files, showDone: await textus.settings.get("showDone") });
  })();
  try {
    await scanning;
  } finally {
    scanning = null;
  }
}

async function toggle(message) {
  const text = await textus.workspace.readText(message.path);
  const lines = text.split("\n");
  const m = TASK.exec(lines[message.line] || "");
  // The file changed since it was listed: nothing is written; the list
  // is read again.
  if (!m || m[4].trim() !== message.text) return refresh();
  lines[message.line] = m[1] + (m[2] === " " ? "x" : " ") + m[3] + m[4];
  await textus.workspace.writeText(message.path, lines.join("\n"));
  await refresh();
}

exports.activate = function () {
  textus.workspace.onDidSaveDocument(refresh);
  textus.workspace.onDidChangeRoot(refresh);
  textus.settings.onDidChange(refresh);
  textus.window.registerWebviewViewProvider("catvinci.tasks.panel", {
    resolveWebviewView: async function (webview) {
      panel = webview;
      webview.onDidDispose(function () {
        if (panel === webview) panel = null;
      });
      webview.onDidReceiveMessage(async function (message) {
        if (message.type === "ready" || message.type === "refresh") await refresh();
        if (message.type === "toggle") await toggle(message);
        if (message.type === "open")
          await textus.window.openFile(message.path, message.heading ? { heading: message.heading } : undefined);
      });
      const html = await textus.plugin.readText("panel.html");
      webview.html = html.replace("{{lang}}", textus.env.language);
    },
  });
};
