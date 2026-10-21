// Word Reader: a .docx opened in a tab, drawn as Word lays it out by
// docx-preview in the page (view.html). "Edit as Markdown" hands the file
// to Textus to convert into a document of the user's, as File > Open did
// before this plugin.
exports.activate = function () {
  textus.window.registerCustomEditorProvider("catvinci.word-reader.docx", {
    resolveCustomEditor: async function (document, webview) {
      webview.onDidReceiveMessage(async function (message) {
        if (message.type === "ready")
          webview.postMessage({
            type: "file",
            name: document.fileName,
            bytes: await document.readBytes(),
          });
        if (message.type === "edit")
          await textus.commands.executeCommand("textus.openAsDocument", document.path);
      });
      const html = await textus.plugin.readText("view.html");
      webview.html = html.replace("{{lang}}", textus.env.language);
    },
  });
};
