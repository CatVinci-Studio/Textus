// Quick Notes: short notes kept by the plugin (textus.storage), listed in
// a sidebar tab. A note goes into the document as a proposal the writer
// accepts, or opens as a new document of its own.
let panel = null;

async function notes() {
  return (await textus.storage.get("notes")) || [];
}

async function save(list) {
  await textus.storage.set("notes", list);
  if (panel) panel.postMessage({ type: "notes", notes: list });
}

async function add(text) {
  const list = await notes();
  const note = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text: text, at: Date.now() };
  await save([note].concat(list));
  return note;
}

exports.activate = function () {
  const zh = textus.env.language === "zh";
  textus.commands.registerCommand("catvinci.quick-notes.capture", async function () {
    const text = await textus.window.showInput({ prompt: zh ? "记下点什么" : "Note something down", value: "" });
    if (text && text.trim()) await add(text.trim());
  });

  textus.window.registerWebviewViewProvider("catvinci.quick-notes.panel", {
    resolveWebviewView: async function (webview) {
      panel = webview;
      webview.onDidDispose(function () {
        if (panel === webview) panel = null;
      });
      webview.onDidReceiveMessage(async function (message) {
        const list = await notes();
        if (message.type === "ready") webview.postMessage({ type: "notes", notes: list });
        if (message.type === "new") {
          const note = await add("");
          webview.postMessage({ type: "focus", id: note.id });
        }
        if (message.type === "edit")
          await save(list.map((n) => (n.id === message.id ? Object.assign({}, n, { text: message.text }) : n)));
        if (message.type === "delete") await save(list.filter((n) => n.id !== message.id));
        const note = list.find((n) => n.id === message.id);
        if (message.type === "insert" && note)
          await textus.document.proposeEdit({
            action: "insert_at_cursor",
            text: note.text,
            reason: zh ? "插入快速笔记" : "Insert a quick note",
          });
        if (message.type === "open" && note) await textus.window.openUntitled(note.text);
      });
      const html = await textus.plugin.readText("panel.html");
      webview.html = html.replace("{{lang}}", textus.env.language);
    },
  });
};
