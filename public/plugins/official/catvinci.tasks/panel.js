(function () {
  "use strict";
  const api = acquireTextusApi();
  const zh = api.language === "zh";
  const t = zh
    ? {
        done: "已完成",
        open: (n) => n + " 项待办",
        none: "打开的文件夹里没有待办任务。",
        nofolder: "打开一个文件夹，这里会列出其中所有文档的任务。",
      }
    : {
        done: "Done",
        open: (n) => n + (n === 1 ? " open task" : " open tasks"),
        none: "No open tasks in the folder.",
        nofolder: "Open a folder, and the tasks of all its documents are listed here.",
      };
  const $ = (id) => document.getElementById(id);
  $("done-label").textContent = t.done;
  $("refresh").onclick = () => api.postMessage({ type: "refresh" });
  let files = [];
  let showDone = !!(api.getState() || {}).showDone;
  $("done").checked = showDone;
  $("done").onchange = () => {
    showDone = $("done").checked;
    api.setState({ showDone: showDone });
    render();
  };

  function render() {
    const box = $("files");
    box.textContent = "";
    if (files === null) {
      $("summary").textContent = "";
      $("empty").textContent = t.nofolder;
      $("empty").hidden = false;
      return;
    }
    let open = 0;
    for (const file of files) {
      const shown = file.tasks.filter((task) => showDone || !task.done);
      open += file.tasks.filter((task) => !task.done).length;
      if (!shown.length) continue;
      const section = document.createElement("section");
      section.className = "file";
      const title = document.createElement("h3");
      title.textContent = file.rel;
      title.title = file.path;
      title.onclick = () => api.postMessage({ type: "open", path: file.path });
      section.append(title);
      for (const task of shown) {
        const row = document.createElement("div");
        row.className = "task" + (task.done ? " done" : "");
        const box = document.createElement("input");
        box.type = "checkbox";
        box.checked = task.done;
        box.setAttribute("aria-label", task.text);
        box.onchange = () =>
          api.postMessage({ type: "toggle", path: file.path, line: task.line, text: task.text });
        const text = document.createElement("span");
        text.className = "text";
        text.textContent = task.text;
        if (task.heading) {
          const where = document.createElement("span");
          where.className = "where";
          where.textContent = task.heading;
          text.append(where);
        }
        text.onclick = () => api.postMessage({ type: "open", path: file.path, heading: task.heading });
        row.append(box, text);
        section.append(row);
      }
      box.append(section);
    }
    $("summary").textContent = t.open(open);
    $("empty").textContent = t.none;
    $("empty").hidden = box.children.length > 0;
  }

  api.onMessage((message) => {
    if (message.type !== "tasks") return;
    files = message.files;
    if (api.getState() === null) {
      showDone = !!message.showDone;
      $("done").checked = showDone;
    }
    render();
  });
  api.postMessage({ type: "ready" });
})();
