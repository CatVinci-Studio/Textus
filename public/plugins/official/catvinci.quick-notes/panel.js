(function () {
  "use strict";
  const api = acquireTextusApi();
  const zh = api.language === "zh";
  const t = zh
    ? { title: "快速笔记", new: "新建", insert: "插入", open: "打开", delete: "删除", empty: "还没有笔记。点“新建”，或在任何地方按 ⌘⌥N / Ctrl+Alt+N。", placeholder: "写点什么…" }
    : { title: "Quick Notes", new: "New", insert: "Insert", open: "Open", delete: "Delete", empty: "No notes yet. Click New, or press ⌘⌥N / Ctrl+Alt+N anywhere.", placeholder: "Write something…" };
  const $ = (id) => document.getElementById(id);
  $("title").textContent = t.title;
  $("new").textContent = t.new;
  $("empty").textContent = t.empty;
  $("new").onclick = () => api.postMessage({ type: "new" });

  const timers = new Map();
  const when = (at) =>
    new Date(at).toLocaleString(api.language, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

  function button(label, type, id) {
    const b = document.createElement("button");
    b.textContent = label;
    b.onclick = () => api.postMessage({ type: type, id: id });
    return b;
  }

  function render(notes) {
    const list = $("notes");
    // A note being typed in keeps its box, caret and all.
    const typing = document.activeElement && document.activeElement.dataset.id;
    $("empty").hidden = notes.length > 0;
    const keep = new Set(notes.map((n) => n.id));
    for (const li of [...list.children]) if (!keep.has(li.dataset.id)) li.remove();
    notes.forEach((note, i) => {
      let li = list.querySelector('li[data-id="' + note.id + '"]');
      if (!li) {
        li = document.createElement("li");
        li.dataset.id = note.id;
        const area = document.createElement("textarea");
        area.dataset.id = note.id;
        area.placeholder = t.placeholder;
        area.addEventListener("input", () => {
          clearTimeout(timers.get(note.id));
          timers.set(
            note.id,
            setTimeout(() => api.postMessage({ type: "edit", id: note.id, text: area.value }), 300),
          );
        });
        const actions = document.createElement("div");
        actions.className = "note-actions";
        const stamp = document.createElement("span");
        stamp.className = "when muted";
        actions.append(stamp, button(t.insert, "insert", note.id), button(t.open, "open", note.id), button(t.delete, "delete", note.id));
        li.append(area, actions);
      }
      const area = li.querySelector("textarea");
      if (typing !== note.id) area.value = note.text;
      li.querySelector(".when").textContent = when(note.at);
      if (list.children[i] !== li) list.insertBefore(li, list.children[i] || null);
    });
  }

  api.onMessage((message) => {
    if (message.type === "notes") render(message.notes);
    if (message.type === "focus") {
      const area = document.querySelector('textarea[data-id="' + message.id + '"]');
      if (area) area.focus();
    }
  });
  api.postMessage({ type: "ready" });
})();
