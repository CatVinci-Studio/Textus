// The graph pages: the whole folder's (global.html) and the sidebar's,
// around the document in front (local.html).
(function () {
  "use strict";
  const api = acquireTextusApi();
  const zh = api.language === "zh";
  const local = document.documentElement.dataset.local === "true";
  const t = zh
    ? {
        search: "搜索笔记",
        fit: "适应窗口",
        full: "完整图谱",
        stats: (n, e) => n + " 篇 · " + e + " 条链接",
        nofolder: "打开一个文件夹，这里会画出其中文档之间的链接。",
        nodoc: "打开文件夹中的一篇文档，这里会显示它周围的链接。",
        alone: "这篇文档还没有链接。用 [[文档名]] 连到别的笔记。",
      }
    : {
        search: "Search notes",
        fit: "Fit",
        full: "Full graph",
        stats: (n, e) =>
          n +
          (n === 1 ? " note · " : " notes · ") +
          e +
          (e === 1 ? " link" : " links"),
        nofolder:
          "Open a folder, and the links between its documents are drawn here.",
        nodoc: "Open a document of the folder to see the links around it.",
        alone:
          "This document has no links yet. Link to another note with [[its name]].",
      };
  const $ = (id) => document.getElementById(id);
  const view = window.createGraphView($("graph"), {
    onOpen: (path) => api.postMessage({ type: "open", path: path }),
  });
  if ($("search")) {
    $("search").placeholder = t.search;
    $("search").addEventListener("input", () =>
      view.setQuery($("search").value),
    );
  }
  if ($("fit")) {
    $("fit").textContent = t.fit;
    $("fit").onclick = () => view.zoomToFit();
  }
  if ($("full")) {
    $("full").textContent = t.full;
    $("full").onclick = () => api.postMessage({ type: "full" });
  }

  let first = true;
  api.onMessage((message) => {
    if (message.type !== "graph") return;
    const graph = message.graph;
    $("status").textContent = !graph
      ? t.nofolder
      : local && !graph.nodes.length
        ? t.nodoc
        : local && graph.nodes.length === 1
          ? t.alone
          : "";
    const data = graph || { nodes: [], edges: [] };
    view.setData(data, message.focus);
    $("stats").textContent = graph
      ? t.stats(view.nodeCount(), view.edgeCount())
      : "";
    if (first && data.nodes.length) {
      first = false;
      setTimeout(() => view.zoomToFit(), 1200);
    }
  });
  api.postMessage({ type: "ready" });
})();
