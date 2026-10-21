(function () {
  "use strict";
  const api = acquireTextusApi();
  const zh = api.language === "zh";
  const t = zh
    ? {
        title: "版本历史",
        none: "这篇文档保存后，每个版本都会出现在这里。",
        nodoc: "打开一篇保存过的文档，这里会显示它的版本。",
        restore: "恢复这个版本",
        open: "作为新文档打开",
        same: "和现在一样",
        large: "改动太多，无法逐行比较。",
        since: "之后的改动：",
      }
    : {
        title: "Version History",
        none: "Each time this document is saved, the version shows here.",
        nodoc: "Open a saved document to see its versions.",
        restore: "Restore This Version",
        open: "Open as a New Document",
        same: "Same as now",
        large: "Too many changes to compare line by line.",
        since: "Changed since:",
      };
  const $ = (id) => document.getElementById(id);
  $("title").textContent = t.title;
  $("refresh").onclick = () => api.postMessage({ type: "refresh" });
  let opened = null;
  let data = { path: null, current: null, versions: [] };

  const when = (at) =>
    new Date(at).toLocaleString(api.language, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

  function diffNode(version) {
    const box = document.createElement("div");
    box.className = "diff";
    const lines = window.lineDiff(version.text, data.current || "");
    if (!lines) {
      box.textContent = t.large;
      return box;
    }
    if (!lines.some((l) => l.kind !== "same")) {
      box.textContent = t.same;
      return box;
    }
    // Changed lines with two of context around them.
    const keep = new Set();
    lines.forEach((l, i) => {
      if (l.kind !== "same") for (let k = i - 2; k <= i + 2; k++) keep.add(k);
    });
    let skipped = false;
    lines.forEach((l, i) => {
      if (!keep.has(i)) {
        if (!skipped) {
          const gap = document.createElement("div");
          gap.className = "gap";
          gap.textContent = "⋯";
          box.append(gap);
        }
        skipped = true;
        return;
      }
      skipped = false;
      const row = document.createElement("div");
      row.className = l.kind;
      row.textContent = (l.kind === "added" ? "+ " : l.kind === "removed" ? "− " : "  ") + l.line;
      box.append(row);
    });
    return box;
  }

  function render() {
    const list = $("versions");
    list.textContent = "";
    $("empty").hidden = !!(data.path && data.versions.length);
    $("empty").textContent = data.path ? t.none : t.nodoc;
    data.versions.forEach((version, index) => {
      const li = document.createElement("li");
      const head = document.createElement("div");
      head.className = "row-head";
      const stamp = document.createElement("span");
      stamp.className = "when";
      stamp.textContent = when(version.at);
      const older = data.versions[index + 1];
      const delta = document.createElement("span");
      delta.className = "delta";
      const change = version.text.length - (older ? older.text.length : 0);
      delta.innerHTML = "";
      const sign = document.createElement("span");
      sign.className = change >= 0 ? "plus" : "minus";
      sign.textContent = (change >= 0 ? "+" : "−") + Math.abs(change);
      delta.append(sign);
      head.append(stamp, delta);
      li.append(head);
      if (opened === version.at) {
        li.classList.add("open");
        const label = document.createElement("div");
        label.className = "muted";
        label.textContent = t.since;
        const actions = document.createElement("div");
        actions.className = "actions";
        const restore = document.createElement("button");
        restore.className = "primary";
        restore.textContent = t.restore;
        restore.onclick = (e) => {
          e.stopPropagation();
          api.postMessage({ type: "restore", at: version.at });
        };
        const open = document.createElement("button");
        open.textContent = t.open;
        open.onclick = (e) => {
          e.stopPropagation();
          api.postMessage({ type: "open", at: version.at });
        };
        actions.append(restore, open);
        li.append(label, diffNode(version), actions);
      }
      li.onclick = () => {
        opened = opened === version.at ? null : version.at;
        render();
      };
      list.append(li);
    });
  }

  api.onMessage((message) => {
    if (message.type !== "versions") return;
    if (message.path !== data.path) opened = null;
    data = message;
    render();
  });
  api.postMessage({ type: "ready" });
})();
