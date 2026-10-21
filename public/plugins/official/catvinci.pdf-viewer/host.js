// PDF Viewer: a PDF opened in a tab of its own, drawn by PDF.js in the
// page (view.html). Once the page is up it is handed the file and the
// zoom to open at.
exports.activate = function () {
  textus.window.registerCustomEditorProvider("catvinci.pdf-viewer.pdf", {
    resolveCustomEditor: async function (document, webview) {
      webview.onDidReceiveMessage(async function (message) {
        if (message.type !== "ready") return;
        const [bytes, zoom] = await Promise.all([
          document.readBytes(),
          textus.settings.get("zoom"),
        ]);
        webview.postMessage({
          type: "file",
          name: document.fileName,
          bytes: bytes,
          zoom: zoom,
        });
      });
      const html = await textus.plugin.readText("view.html");
      webview.html = html.replace("{{lang}}", textus.env.language);
    },
  });
};
