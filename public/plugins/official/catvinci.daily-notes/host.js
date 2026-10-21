// Calendar & Daily Notes: a note per day, YYYY-MM-DD.md in a folder of
// the open folder (Settings: "Daily" by default), made from a template the
// first time a day is opened. The sidebar's calendar marks the days that
// have one.
let panel = null;

const pad = (n) => String(n).padStart(2, "0");
function dateOf(day) {
  return day.getFullYear() + "-" + pad(day.getMonth() + 1) + "-" + pad(day.getDate());
}

/** `root` and `parts` joined with the root's own separator. */
function join(root) {
  const sep = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  const parts = Array.prototype.slice.call(arguments, 1).filter(Boolean);
  return [root.replace(/[\\/]+$/, "")].concat(parts).join(sep);
}

async function folder() {
  const root = await textus.workspace.rootPath();
  if (!root) return null;
  const name = String((await textus.settings.get("folder")) || "Daily").replace(/^[\\/]+|[\\/]+$/g, "");
  return { root: root, dir: join(root, name) };
}

/** The dates that have a note, from the folder's file names. */
async function noteDates() {
  const where = await folder();
  if (!where) return null;
  try {
    const entries = await textus.workspace.list(where.dir);
    return entries
      .map((e) => /^(\d{4}-\d{2}-\d{2})\.md$/.exec(e.name))
      .filter(Boolean)
      .map((m) => m[1]);
  } catch (err) {
    // No folder yet: no notes yet.
    return [];
  }
}

async function refresh() {
  if (!panel) return;
  panel.postMessage({
    type: "dates",
    dates: await noteDates(),
    weekStart: await textus.settings.get("weekStart"),
  });
}

async function openDay(date) {
  const where = await folder();
  if (!where) {
    await textus.window.showMessage(
      textus.env.language === "zh" ? "先打开一个文件夹，每日笔记会放在里面。" : "Open a folder first: daily notes are kept in it.",
    );
    return;
  }
  const path = join(where.dir, date + ".md");
  const dates = (await noteDates()) || [];
  if (!dates.includes(date)) {
    const template = String((await textus.settings.get("template")) || "# {{date}}\\n\\n");
    await textus.workspace.writeText(path, template.replace(/\{\{date\}\}/g, date).replace(/\\n/g, "\n"));
  }
  await textus.window.openFile(path);
  await refresh();
}

exports.activate = function () {
  textus.commands.registerCommand("catvinci.daily-notes.today", function () {
    return openDay(dateOf(new Date()));
  });
  textus.workspace.onDidChangeRoot(refresh);
  textus.workspace.onDidSaveDocument(refresh);
  textus.settings.onDidChange(refresh);
  textus.window.registerWebviewViewProvider("catvinci.daily-notes.calendar", {
    resolveWebviewView: async function (webview) {
      panel = webview;
      webview.onDidDispose(function () {
        if (panel === webview) panel = null;
      });
      webview.onDidReceiveMessage(async function (message) {
        if (message.type === "ready") await refresh();
        if (message.type === "open") await openDay(message.date);
      });
      const html = await textus.plugin.readText("panel.html");
      webview.html = html.replace("{{lang}}", textus.env.language);
    },
  });
};
