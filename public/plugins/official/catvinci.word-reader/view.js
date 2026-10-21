(function () {
  "use strict";
  const api = acquireTextusApi();
  const t =
    api.language === "zh"
      ? { edit: "作为 Markdown 编辑", loading: "正在打开…", failed: "无法打开这个 Word 文档：" }
      : { edit: "Edit as Markdown", loading: "Opening…", failed: "This Word document can't be opened: " };
  const $ = (id) => document.getElementById(id);
  $("edit").textContent = t.edit;
  $("edit").onclick = () => api.postMessage({ type: "edit" });

  api.onMessage(async (message) => {
    if (message.type !== "file") return;
    $("name").textContent = message.name;
    $("status").textContent = t.loading;
    try {
      await window.docx.renderAsync(new Blob([message.bytes]), $("pages"), undefined, {
        inWrapper: true,
        ignoreLastRenderedPageBreak: true,
        experimental: true,
        useBase64URL: true,
      });
      $("status").textContent = "";
    } catch (err) {
      $("status").textContent = t.failed + ((err && err.message) || err);
    }
  });
  api.postMessage({ type: "ready" });
})();
