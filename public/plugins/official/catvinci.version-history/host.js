// Version History: each save of a document kept as a version, in the
// plugin's own storage ("v:<path>", newest first), up to the number set in
// Settings. The sidebar lists the versions of the document in front; one
// comes back as a proposal replacing the document, accepted or rejected
// like any edit, or opens as a new document.
let panel = null;
const MAX_TEXT = 2 * 1024 * 1024;

async function versionsOf(path) {
  return (path && (await textus.storage.get("v:" + path))) || [];
}

async function record(saved) {
  if (!saved.path || saved.text.length > MAX_TEXT) return;
  const list = await versionsOf(saved.path);
  if (list[0] && list[0].text === saved.text) return;
  const keep = Math.max(1, Number(await textus.settings.get("keep")) || 50);
  list.unshift({ at: Date.now(), text: saved.text });
  await textus.storage.set("v:" + saved.path, list.slice(0, keep));
  await show();
}

async function show() {
  if (!panel) return;
  const path = await textus.document.getPath();
  panel.postMessage({
    type: "versions",
    path: path,
    current: path ? await textus.document.getText() : null,
    versions: await versionsOf(path),
  });
}

exports.activate = function () {
  const zh = textus.env.language === "zh";
  textus.workspace.onDidSaveDocument(record);
  textus.document.onDidChangeActive(show);
  textus.window.registerWebviewViewProvider("catvinci.version-history.panel", {
    resolveWebviewView: async function (webview) {
      panel = webview;
      webview.onDidDispose(function () {
        if (panel === webview) panel = null;
      });
      webview.onDidReceiveMessage(async function (message) {
        if (message.type === "ready" || message.type === "refresh") await show();
        const path = await textus.document.getPath();
        const version = (await versionsOf(path)).find((v) => v.at === message.at);
        if (!version) return;
        if (message.type === "restore") {
          const current = await textus.document.getText();
          await textus.document.proposeEdit({
            action: "replace",
            anchor: current,
            text: version.text,
            reason: zh ? "恢复到这个版本" : "Restore this version",
          });
        }
        if (message.type === "open") await textus.window.openUntitled(version.text);
      });
      const html = await textus.plugin.readText("panel.html");
      webview.html = html.replace("{{lang}}", textus.env.language);
    },
  });
};
