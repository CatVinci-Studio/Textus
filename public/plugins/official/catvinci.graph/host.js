// Graph View: the open folder's documents and the links between them
// (links.js builds the graph), drawn as a graph in a tab of its own, and
// around the document in front in the sidebar. Read again, a moment
// after, whenever a document is saved or the folder changes.
/* global graphLinks */
let graph = null;
let building = null;
let stale = true;
const views = new Set();
let local = null;

async function build() {
  const root = await textus.workspace.rootPath();
  if (!root) return null;
  const docs = await textus.workspace.findDocuments();
  const read = [];
  for (const doc of docs) {
    if (!/\.(md|markdown)$/i.test(doc.path)) continue;
    try {
      read.push({
        path: doc.path,
        rel: doc.rel.replace(/\\/g, "/"),
        text: await textus.workspace.readText(doc.path),
      });
    } catch {
      // Unreadable: left out.
    }
  }
  return graphLinks.buildGraph(read);
}

async function current() {
  if (stale || !graph) {
    stale = false;
    building = building || build().finally(() => (building = null));
    graph = await building;
  }
  return graph;
}

async function sendGlobal(view) {
  const g = await current();
  const orphans = await textus.settings.get("orphans");
  if (!g) return view.postMessage({ type: "graph", graph: null });
  let shown = g;
  if (!orphans) {
    const linked = new Set();
    for (const e of g.edges) linked.add(e.source).add(e.target);
    shown = { nodes: g.nodes.filter((n) => linked.has(n.id)), edges: g.edges };
  }
  view.postMessage({
    type: "graph",
    graph: shown,
    focus: await textus.document.getPath(),
  });
}

async function sendLocal() {
  if (!local) return;
  const g = await current();
  const focus = await textus.document.getPath();
  if (!g || !focus || !g.nodes.some((n) => n.id === focus))
    return local.postMessage({
      type: "graph",
      graph: g ? { nodes: [], edges: [] } : null,
      focus: focus,
    });
  const depth = Number(await textus.settings.get("depth")) || 1;
  local.postMessage({
    type: "graph",
    graph: graphLinks.neighbourhood(g, focus, depth),
    focus: focus,
  });
}

let timer = 0;
function changed() {
  stale = true;
  clearTimeout(timer);
  timer = setTimeout(function () {
    for (const view of views) void sendGlobal(view);
    void sendLocal();
  }, 400);
}

function wire(webview, isLocal) {
  webview.onDidReceiveMessage(async function (message) {
    if (message.type === "ready") {
      if (isLocal) await sendLocal();
      else await sendGlobal(webview);
    }
    if (message.type === "open" && message.path)
      await textus.window.openFile(message.path);
    if (message.type === "full")
      await textus.window.openView("catvinci.graph.global");
  });
}

async function page(webview, file) {
  const html = await textus.plugin.readText(file);
  webview.html = html.replace("{{lang}}", textus.env.language);
}

exports.activate = function () {
  textus.workspace.onDidSaveDocument(changed);
  textus.workspace.onDidChangeRoot(changed);
  textus.settings.onDidChange(changed);
  textus.document.onDidChangeActive(function () {
    void sendLocal();
    for (const view of views) void sendGlobal(view);
  });
  textus.commands.registerCommand("catvinci.graph.open", function () {
    return textus.window.openView("catvinci.graph.global");
  });
  textus.window.registerWebviewViewProvider("catvinci.graph.global", {
    resolveWebviewView: async function (webview) {
      views.add(webview);
      webview.onDidDispose(() => views.delete(webview));
      wire(webview, false);
      await page(webview, "global.html");
    },
  });
  textus.window.registerWebviewViewProvider("catvinci.graph.local", {
    resolveWebviewView: async function (webview) {
      local = webview;
      webview.onDidDispose(function () {
        if (local === webview) local = null;
      });
      wire(webview, true);
      await page(webview, "local.html");
    },
  });
};
