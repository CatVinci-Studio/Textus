(function () {
  "use strict";
  const api = acquireTextusApi();
  const zh = api.language === "zh";
  const t = zh
    ? {
        addList: "添加列表",
        addCard: "+ 添加卡片",
        markdown: "作为 Markdown 编辑",
        newList: "新列表",
        saved: "已保存",
        saving: "正在保存…",
        remove: "删除",
      }
    : {
        addList: "Add list",
        addCard: "+ Add a card",
        markdown: "Edit as Markdown",
        newList: "New list",
        saved: "Saved",
        saving: "Saving…",
        remove: "Remove",
      };
  const $ = (id) => document.getElementById(id);
  const md = window.kanbanMarkdown;
  $("add-list").textContent = t.addList;
  $("markdown").textContent = t.markdown;
  $("markdown").onclick = () => api.postMessage({ type: "markdown" });

  let board = null;
  let timer = 0;
  let dragged = null;

  function save() {
    $("state").textContent = t.saving;
    clearTimeout(timer);
    timer = setTimeout(
      () => api.postMessage({ type: "save", text: md.serialize(board) }),
      300,
    );
  }
  function changed() {
    render();
    save();
  }

  /** An inline field over `node`'s text; `done` gets the new text. */
  function editInPlace(node, value, multiline, done) {
    const field = document.createElement(multiline ? "textarea" : "input");
    field.value = value;
    node.replaceWith(field);
    field.focus();
    field.select();
    let finished = false;
    const finish = (keep) => {
      if (finished) return;
      finished = true;
      if (keep && field.value.trim()) done(field.value.trim());
      else render();
    };
    field.addEventListener("blur", () => finish(true));
    field.addEventListener("keydown", (e) => {
      if (e.isComposing) return;
      if (e.key === "Escape") finish(false);
      if (e.key === "Enter" && (!multiline || e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        finish(true);
      }
    });
  }

  function removeButton(onClick) {
    const b = document.createElement("button");
    b.className = "icon remove";
    b.textContent = "✕";
    b.setAttribute("aria-label", t.remove);
    b.onclick = onClick;
    return b;
  }

  function cardNode(list, card) {
    const li = document.createElement("li");
    li.className = "card" + (card.done ? " done" : "");
    li.draggable = true;
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = card.done;
    box.setAttribute("aria-label", card.text);
    box.onchange = () => {
      card.done = box.checked;
      changed();
    };
    const text = document.createElement("span");
    text.className = "card-text";
    text.textContent = card.text;
    text.onclick = () =>
      editInPlace(text, card.text, true, (value) => {
        card.text = value;
        changed();
      });
    li.append(
      box,
      text,
      removeButton(() => {
        list.cards.splice(list.cards.indexOf(card), 1);
        changed();
      }),
    );
    li.addEventListener("dragstart", (e) => {
      dragged = { list: list, card: card };
      li.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", card.text);
    });
    li.addEventListener("dragend", () => {
      dragged = null;
      li.classList.remove("dragging");
    });
    return li;
  }

  function listNode(list) {
    const section = document.createElement("section");
    section.className = "list";
    const head = document.createElement("div");
    head.className = "list-head";
    const title = document.createElement("span");
    title.className = "list-title";
    title.textContent = list.title;
    title.onclick = () =>
      editInPlace(title, list.title, false, (value) => {
        list.title = value.replace(/\n/g, " ");
        changed();
      });
    const count = document.createElement("span");
    count.className = "list-count muted";
    count.textContent = String(list.cards.length);
    head.append(title, count);
    if (!list.cards.length)
      head.append(
        removeButton(() => {
          board.lists.splice(board.lists.indexOf(list), 1);
          changed();
        }),
      );
    const cards = document.createElement("ul");
    cards.className = "cards";
    for (const card of list.cards) cards.append(cardNode(list, card));
    // Dropped where the pointer is: before the card under it, or last.
    cards.addEventListener("dragover", (e) => {
      if (!dragged) return;
      e.preventDefault();
      cards.classList.add("drop-target");
    });
    cards.addEventListener("dragleave", () =>
      cards.classList.remove("drop-target"),
    );
    cards.addEventListener("drop", (e) => {
      e.preventDefault();
      cards.classList.remove("drop-target");
      if (!dragged) return;
      const from = dragged;
      const nodes = [...cards.children];
      const before = nodes.findIndex((n) => {
        const r = n.getBoundingClientRect();
        return e.clientY < r.top + r.height / 2;
      });
      from.list.cards.splice(from.list.cards.indexOf(from.card), 1);
      let at = before < 0 ? list.cards.length : before;
      if (from.list === list && before > from.list.cards.length)
        at = list.cards.length;
      list.cards.splice(Math.min(at, list.cards.length), 0, from.card);
      changed();
    });
    const add = document.createElement("button");
    add.className = "add-card";
    add.textContent = t.addCard;
    add.onclick = () => {
      const card = { text: "", done: false };
      list.cards.push(card);
      render();
      const nodes = document.querySelectorAll(".list");
      const node = nodes[board.lists.indexOf(list)].querySelector(
        ".card:last-child .card-text",
      );
      editInPlace(node, "", true, (value) => {
        card.text = value;
        changed();
      });
      // Given up empty: no card.
      const field = nodes[board.lists.indexOf(list)].querySelector("textarea");
      field.addEventListener("blur", () => {
        if (!card.text) {
          list.cards.splice(list.cards.indexOf(card), 1);
          render();
        }
      });
    };
    section.append(head, cards, add);
    return section;
  }

  function render() {
    const root = $("board");
    root.textContent = "";
    for (const list of board.lists) root.append(listNode(list));
  }

  $("add-list").onclick = () => {
    board.lists.push({ title: t.newList, cards: [] });
    changed();
  };

  api.onMessage((message) => {
    if (message.type === "file") {
      board = md.parse(message.text);
      render();
    }
    if (message.type === "saved") $("state").textContent = t.saved;
    if (message.type === "error") $("state").textContent = message.message;
  });
  api.postMessage({ type: "ready" });
})();
