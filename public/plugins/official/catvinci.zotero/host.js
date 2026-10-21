// Zotero: a citation from the user's Zotero library, inserted where the
// caret is as a proposal. The library is searched through Zotero 7's local
// API on this computer (http://localhost:23119/api/), which Zotero serves
// once "Allow other applications on this computer to communicate with
// Zotero" is on - nothing leaves the computer.
const API = "http://localhost:23119/api/users/0/items/top";

function zh() {
  return textus.env.language === "zh";
}

function authors(item) {
  const people = (item.data.creators || []).filter(
    (c) => c.creatorType === "author" || !c.creatorType,
  );
  const name = (c) => c.lastName || c.name || "";
  if (!people.length) return "";
  if (people.length === 1) return name(people[0]);
  if (people.length === 2)
    return name(people[0]) + (zh() ? " 和 " : " & ") + name(people[1]);
  return name(people[0]) + " et al.";
}

function year(item) {
  const match = /\d{4}/.exec(
    item.data.date || (item.meta && item.meta.parsedDate) || "",
  );
  return match ? match[0] : "n.d.";
}

/** The citation as Settings › Zotero says to write it. */
function citation(item, style) {
  const who = authors(item) || item.data.title || item.key;
  if (style === "link")
    return (
      "[" +
      who +
      " (" +
      year(item) +
      ")](zotero://select/library/items/" +
      item.key +
      ")"
    );
  if (style === "text") return "(" + who + ", " + year(item) + ")";
  const key =
    item.data.citationKey ||
    (/Citation Key:\s*(\S+)/.exec(item.data.extra || "") || [])[1];
  return key ? "[@" + key + "]" : "(" + who + ", " + year(item) + ")";
}

async function search(query) {
  const url =
    API +
    "?q=" +
    encodeURIComponent(query) +
    "&qmode=titleCreatorYear&limit=30&format=json";
  let response;
  try {
    response = await textus.net.fetch(url, {
      headers: { "Zotero-API-Version": "3" },
    });
  } catch (cause) {
    throw new Error(
      zh()
        ? "连不上 Zotero。请打开 Zotero 7，并在 设置 › 高级 中打开“允许此计算机上的其他应用程序与 Zotero 通信”。"
        : "Can't reach Zotero. Open Zotero 7, and turn on Settings › Advanced › Allow other applications on this computer to communicate with Zotero.",
      { cause: cause },
    );
  }
  if (!response.ok) throw new Error("Zotero: " + response.status);
  return response.json();
}

exports.activate = function () {
  textus.commands.registerCommand("catvinci.zotero.cite", async function () {
    const query = await textus.window.showInput({
      prompt: zh()
        ? "在 Zotero 中搜索（标题、作者或年份）"
        : "Search Zotero (title, author or year)",
      value: "",
    });
    if (!query || !query.trim()) return;
    let items;
    try {
      items = await search(query.trim());
    } catch (err) {
      await textus.window.showMessage(err.message, { tone: "warning" });
      return;
    }
    if (!items.length) {
      await textus.window.showMessage(zh() ? "没有找到。" : "Nothing found.");
      return;
    }
    const style = await textus.settings.get("style");
    const picked = await textus.window.showQuickPick(
      items.map((item) => ({
        label: item.data.title || item.key,
        description: [authors(item), year(item)].filter(Boolean).join(" · "),
        value: item.key,
      })),
      { placeholder: zh() ? "选择要引用的文献" : "Choose what to cite" },
    );
    const item = items.find((i) => i.key === picked);
    if (!item) return;
    await textus.document.proposeEdit({
      action: "insert_at_cursor",
      text: citation(item, style),
      reason: zh()
        ? "引用 " + (item.data.title || "")
        : "Cite " + (item.data.title || ""),
    });
  });
};
