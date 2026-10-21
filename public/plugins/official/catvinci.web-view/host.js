// Web View: web pages in a tab beside the notes. The tab itself is
// Textus's (window.openWebPage), so the page keeps its own cookies and
// storage; this plugin adds the ways to open one.
function address(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return null;
  return /^https?:\/\//i.test(trimmed)
    ? trimmed.replace(/^http:/i, "https:")
    : "https://" + trimmed;
}

function openPage(url) {
  const page = address(url);
  if (page) return textus.window.openWebPage(page);
}

exports.activate = function () {
  const zh = textus.env.language === "zh";
  textus.commands.registerCommand("catvinci.web-view.open", async function () {
    const typed = await textus.window.showInput({
      prompt: zh ? "网址" : "Web address",
      value: "https://",
    });
    if (typed) await openPage(typed);
  });
  textus.commands.registerCommand(
    "catvinci.web-view.openSelection",
    async function () {
      const selection = await textus.document.getSelection();
      const text = selection && selection.text;
      // The link itself, or a Markdown link's target.
      const target =
        text && (/\((https?:\/\/[^)\s]+)\)/.exec(text) || [null, text])[1];
      if (target) await openPage(target);
    },
  );
  textus.commands.registerCommand("catvinci.web-view.home", async function () {
    await openPage(await textus.settings.get("home"));
  });
};
