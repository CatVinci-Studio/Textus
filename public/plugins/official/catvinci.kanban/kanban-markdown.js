// A board's Markdown, both ways: front matter (kept as written), then a
// list per "## " heading and a card per list item under it - "- [ ] text"
// or "- [x] text" (done), its indented lines part of it. Anything else
// before the first list (a paragraph) is kept as the board's preamble.
(function (root) {
  "use strict";
  const ITEM = /^[-*+]\s+(?:\[( |x|X)\]\s+)?(.*)$/;

  function parse(text) {
    const lines = String(text).replace(/\r\n/g, "\n").split("\n");
    let front = "";
    let i = 0;
    if (lines[0] === "---") {
      const end = lines.indexOf("---", 1);
      if (end > 0) {
        front = lines.slice(0, end + 1).join("\n");
        i = end + 1;
      }
    }
    const preamble = [];
    const lists = [];
    let list = null;
    let card = null;
    for (; i < lines.length; i++) {
      const line = lines[i];
      const heading = /^##\s+(.*?)\s*$/.exec(line);
      if (heading) {
        list = { title: heading[1], cards: [] };
        lists.push(list);
        card = null;
        continue;
      }
      if (!list) {
        preamble.push(line);
        continue;
      }
      const item = ITEM.exec(line);
      if (item) {
        card = { text: item[2], done: !!item[1] && item[1] !== " " };
        list.cards.push(card);
      } else if (card && /^\s+\S/.test(line)) {
        card.text += "\n" + line.replace(/^\s{2,4}/, "");
      } else if (line.trim()) {
        // A stray line in a list: a card of its own, so nothing is lost.
        card = { text: line.trim(), done: false };
        list.cards.push(card);
      } else {
        card = null;
      }
    }
    return { front: front, preamble: preamble.join("\n").trim(), lists: lists };
  }

  function serialize(board) {
    const parts = [];
    if (board.front) parts.push(board.front);
    if (board.preamble) parts.push(board.preamble);
    for (const list of board.lists) {
      const cards = list.cards.map(function (card) {
        const [first, ...rest] = card.text.split("\n");
        return (
          "- [" + (card.done ? "x" : " ") + "] " + first + rest.map((l) => "\n    " + l).join("")
        );
      });
      parts.push("## " + list.title + (cards.length ? "\n\n" + cards.join("\n") : ""));
    }
    return parts.join("\n\n") + "\n";
  }

  root.kanbanMarkdown = { parse: parse, serialize: serialize };
})(typeof window !== "undefined" ? window : globalThis);
