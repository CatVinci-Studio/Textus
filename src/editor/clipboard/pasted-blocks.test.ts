// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { closeViews, openView } from "../editor-view-kit";

// Pasted text keeps its line breaks, a quote copied with its bars ("▎ ")
// comes in as a quote, and blocks pasted into others land sensibly.

afterEach(closeViews);

const open = (markdown = "") => openView(markdown, { enableCompletion: false });

const all = (root: HTMLElement, selector: string) => [
  ...root.querySelectorAll<HTMLElement>(selector),
];
const texts = (root: HTMLElement, selector: string) =>
  all(root, selector).map((e) => e.textContent);
/** Line breaks the user put in, not ProseMirror's trailing one. */
const breaks = (el: HTMLElement) =>
  all(el, "br").filter(
    (br) => !br.classList.contains("ProseMirror-trailingBreak"),
  ).length;

it("pasted lines stay lines, and a quote with bars is a quote", async () => {
  const t = await open();
  t.paste(
    [
      "▎ Hi Denisse,",
      "▎",
      "▎ I went through your grading again.",
      "▎ The points were taken from the written analysis.",
      "▎",
      "▎ - T1, T2, T7: brief points.",
      "▎ - T3, T4: missing statistics.",
      "▎",
      "▎ Best,",
      "▎ Youzhe",
    ].join("\n"),
  );
  const [quote, ...more] = all(t.view.dom, "blockquote");
  expect(more).toEqual([]);
  expect(quote.textContent).not.toContain("▎");
  expect(all(quote, "li")).toHaveLength(2);
  // "Best," and "Youzhe" on lines of their own, as in the email.
  const line = (text: string) =>
    all(quote, "p").find((p) => p.textContent!.includes(text))!;
  expect(breaks(line("Best,"))).toBe(1);
  expect(breaks(line("I went through"))).toBe(1);
});

it("a quote that starts with a list stays a quote", async () => {
  const t = await open();
  t.paste("> - one\n> - two");
  expect(all(t.view.dom, "blockquote")).toHaveLength(1);
  expect(texts(t.view.dom, "blockquote li")).toEqual(["one", "two"]);
});

it("a code block pasted on an empty list item stays a code block", async () => {
  const t = await open();
  t.type("- item");
  t.press("Enter");
  t.paste("```js\nx\ny\n```");
  expect(texts(t.view.dom, "li pre")).toEqual([
    expect.stringContaining("x\ny"),
  ]);
  expect(all(t.view.dom, "li")[1].querySelector("p")?.textContent).toBe("");
});

it("a code block pasted into a table cell stays in the cell as text", async () => {
  const t = await open("| a | b |\n| - | - |\n| c | d |");
  t.caretAt("c", 1);
  t.paste("```js\nx\n```");
  expect(all(t.view.dom, "table")).toHaveLength(1);
  expect(all(t.view.dom, "pre")).toHaveLength(0);
});

it("a code block pasted in the middle of a line stays a code block between its halves", async () => {
  const t = await open();
  t.type("beforeafter");
  t.caretAt("beforeafter", 6);
  t.paste("```js\nx\ny\n```");
  expect(texts(t.view.dom, "pre")).toEqual([expect.stringContaining("x\ny")]);
  expect(texts(t.view.dom, ":scope > p")).toEqual(["before", "after"]);
});

it("a table pasted on a new line takes that line, and one as wide pasted in a cell goes in as rows under the caret's, as its HTML does", async () => {
  const t = await open();
  t.type("Before");
  t.press("Enter");
  t.paste("| a | b |\n| - | - |\n| c | d |");
  expect(texts(t.view.dom, ":scope > p")).toEqual(["Before"]);
  t.caretAt("d", 1);
  t.paste("| p | q |\n| - | - |\n| r | s |");
  expect(all(t.view.dom, "table")).toHaveLength(1);
  expect(texts(t.view.dom, "tr")).toEqual(["ab", "cd", "pq", "rs"]);
});

it("plain pasted lines keep their breaks", async () => {
  const t = await open();
  t.paste("Dear Sam,\nThanks for the notes.\nSee you Monday.");
  expect(breaks(all(t.view.dom, "p")[0])).toBe(2);
});

it("a paragraph a PDF wrapped at its width comes in whole", async () => {
  const t = await open();
  t.paste(
    [
      "The results show that the proposed method significantly",
      "outperforms the baseline on all three benchmarks. In particular,",
      "the effect is strongest for long documents, where the corpus",
      "contains more than ten thousand files.",
    ].join("\n"),
  );
  const p = all(t.view.dom, "p")[0];
  expect(p.textContent).toContain("significantly outperforms the baseline");
  expect(breaks(p)).toBe(0);
});

it("a terminal's output is a code block, its columns kept", async () => {
  const t = await open();
  t.paste(
    "Filesystem      Size  Used Avail\n/dev/nvme0n1p2  468G  301G  144G\ntmpfs            16G  1.2M   16G",
  );
  expect(texts(t.view.dom, "pre")).toEqual([
    expect.stringContaining("tmpfs            16G"),
  ]);
});

it("a line ending in a web address keeps its link and its break", async () => {
  const t = await open();
  t.paste("Map: https://map.example.com/?q=hall\nSee you there");
  const p = all(t.view.dom, "p")[0];
  expect(breaks(p)).toBe(1);
  expect(p.textContent).not.toContain("\\");
});

it("Google Docs' bold, italic and struck text stay so", async () => {
  const t = await open();
  t.paste(
    "Friday and mostly (old)",
    '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1"><p dir="ltr"><span style="font-weight:700;">Friday</span><span style="font-weight:400;"> and </span><span style="font-style:italic;">mostly</span><span> </span><span style="text-decoration:line-through;">(old)</span></p></b>',
  );
  expect(texts(t.view.dom, "strong")).toEqual(["Friday"]);
  expect(texts(t.view.dom, "em")).toEqual(["mostly"]);
  expect(texts(t.view.dom, "del, s")).toEqual(["(old)"]);
});

it("an Outlook message comes in without its empty paragraphs", async () => {
  const t = await open();
  t.paste(
    "Hi Chen,\n\nSee the sheet.\n\nThanks,",
    '<p class=MsoNormal>Hi Chen,<o:p></o:p></p><p class=MsoNormal><o:p>&nbsp;</o:p></p><p class=MsoNormal>See the <a href="https://nam12.safelinks.protection.outlook.com/?url=https%3A%2F%2Fexample.com%2Fq3&amp;data=05">sheet</a>.<o:p></o:p></p><p class=MsoNormal><o:p>&nbsp;</o:p></p><p class=MsoNormal>Thanks,<o:p></o:p></p>',
  );
  expect(all(t.view.dom, ":scope > p")).toHaveLength(3);
  expect(all(t.view.dom, "a").map((a) => a.getAttribute("href"))).toEqual([
    "https://example.com/q3",
  ]);
});

it("pasted code keeps its lines, Chinese comments and long lines too", async () => {
  const lines = Array.from({ length: 12 }, (_, i) =>
    i % 3
      ? `call(${i}); // a line of code that runs on a while`
      : `  // 第 ${i} 行，中文注释`,
  );
  const t = await open();
  t.paste("Before\n\n```js\n" + lines.join("\n") + "\n```\n\nAfter");
  expect(texts(t.view.dom, "pre code")).toEqual([lines.join("\n")]);
});

it("a to-do's text copied whole pastes as a to-do on its own line, as text in a line", async () => {
  const t = await openView("- [ ] alpha\n- plain\n\npara");
  const copy = (word: string) => {
    const at = t.caretAt(word);
    t.select(at, at + word.length);
    const { dom, text } = t.view.serializeForClipboard(
      t.view.state.selection.content(),
    );
    return { text, html: dom.innerHTML };
  };
  const task = copy("alpha");
  t.caretAtEnd();
  t.press("Enter");
  t.paste(task.text, task.html);
  expect(t.markdown()).toBe("- [ ] alpha\n- plain\n\npara\n\n- [ ] alpha");
  const para = t.caretAt("para", 4);
  t.select(para, para);
  t.paste(task.text, task.html);
  expect(t.markdown()).toContain("paraalpha");
  // Part of its text is text, on a line of its own too.
  const part = copy("lph");
  t.caretAtEnd();
  t.press("Enter");
  t.press("Enter"); // out of the list
  t.paste(part.text, part.html);
  expect(t.markdown()).toMatch(/\n\nlph$/);
});

it("a table copies as other apps read one, and pastes back as itself", async () => {
  const source = "| a | **b** |\n| :-: | --- |\n| 1 | `2` |";
  const t = await openView(`${source}\n\nend`);
  const { CellSelection } = await import("@milkdown/kit/prose/tables");
  const cellAt = (text: string) => {
    let at = -1;
    t.view.state.doc.descendants((n, pos) => {
      if (at < 0 && n.isText && n.text === text) at = pos;
    });
    const $at = t.view.state.doc.resolve(at);
    let d = $at.depth;
    while (!/cell/.test($at.node(d).type.spec.tableRole ?? "")) d--;
    return $at.before(d);
  };
  const copy = (from: string, to: string) => {
    t.view.dispatch(
      t.view.state.tr.setSelection(
        CellSelection.create(t.view.state.doc, cellAt(from), cellAt(to)),
      ),
    );
    return t.view.serializeForClipboard(t.view.state.selection.content());
  };
  const whole = copy("a", "2");
  const table = whole.dom.querySelector("table")!;
  expect(table.getAttribute("border")).toBe("1");
  expect(table.querySelector("thead th")?.textContent).toBe("a");
  expect(table.querySelector("td p")).toBeNull();
  expect(table.querySelector("td")?.getAttribute("style")).toContain("border");
  // Body cells alone: a row of tab-separated cells, lined all the same.
  const body = copy("1", "2");
  expect(body.text).toBe("1\t2");
  expect(body.dom.querySelector("td")?.getAttribute("style")).toContain(
    "border",
  );
  expect(body.dom.querySelector("td p")).toBeNull();
  t.caretAtEnd();
  t.press("Enter");
  t.paste(whole.text, whole.dom.innerHTML);
  const back = t.markdown().split("end")[1];
  expect(back).toMatch(/\|\s*a\s*\|\s*\*\*b\*\*\s*\|/);
  expect(back).toMatch(/\|\s*1\s*\|\s*`2`\s*\|/);
});

it("list items pasted into a list take its kind; on a blank line they stay as they were", async () => {
  const into = async (doc: string, at: string, pasted: string) => {
    const t = await open(doc);
    t.caretAt(at, at.length);
    t.press("Enter");
    t.paste(pasted);
    return t.markdown().trim();
  };
  expect(await into("- [ ] one", "one", "- a\n- b")).toBe(
    "- [ ] one\n- [ ] a\n- [ ] b",
  );
  expect(await into("- one", "one", "- [ ] a\n- [x] b")).toBe(
    "- one\n- a\n- b",
  );
  expect(await into("- [ ] one", "one", "- [x] a")).toBe("- [ ] one\n- [x] a");
  expect(await into("1. one", "one", "- [ ] a")).toBe("1. one\n2. a");
  const t = await open("Para");
  t.caretAtEnd();
  t.press("Enter");
  t.paste("- [ ] a\n- b");
  expect(t.markdown().trim()).toBe("Para\n\n- [ ] a\n- b");
});
