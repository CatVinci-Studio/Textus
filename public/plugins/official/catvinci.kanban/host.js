// Kanban: a board kept as Markdown - "## List" headings, "- [ ] card"
// tasks under them, the front matter Obsidian's Kanban writes - opened as
// a board in its own tab. The page (board.html) parses and writes the
// Markdown; this reads and writes the file.
const TEMPLATE = function (zh) {
  const lists = zh ? ["待办", "进行中", "已完成"] : ["To do", "Doing", "Done"];
  return "---\nkanban-plugin: basic\n---\n\n" + lists.map((l) => "## " + l + "\n").join("\n");
};

function join(root, name) {
  const sep = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  return root.replace(/[\\/]+$/, "") + sep + name;
}

exports.activate = function () {
  const zh = textus.env.language === "zh";
  textus.commands.registerCommand("catvinci.kanban.new", async function () {
    const root = await textus.workspace.rootPath();
    if (!root) {
      await textus.window.showMessage(zh ? "先打开一个文件夹，看板会存在里面。" : "Open a folder first: the board is kept in it.");
      return;
    }
    const name = await textus.window.showInput({ prompt: zh ? "看板名称" : "Board name", value: zh ? "看板" : "Board" });
    if (!name || !name.trim()) return;
    const path = join(root, name.trim().replace(/[\\/:*?"<>|]/g, "-") + ".kanban.md");
    const existing = (await textus.workspace.list(root)).some((e) => e.path === path);
    if (!existing) await textus.workspace.writeText(path, TEMPLATE(zh));
    await textus.window.openFile(path);
  });

  textus.window.registerCustomEditorProvider("catvinci.kanban.board", {
    resolveCustomEditor: async function (document, webview) {
      webview.onDidReceiveMessage(async function (message) {
        if (message.type === "ready")
          webview.postMessage({ type: "file", text: await document.readText() });
        if (message.type === "save") {
          try {
            await document.writeText(message.text);
            webview.postMessage({ type: "saved" });
          } catch (err) {
            webview.postMessage({ type: "error", message: String((err && err.message) || err) });
          }
        }
        if (message.type === "markdown")
          await textus.commands.executeCommand("textus.openAsDocument", document.path);
      });
      const html = await textus.plugin.readText("board.html");
      webview.html = html.replace("{{lang}}", textus.env.language);
    },
  });
};
