// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { closeViews, openView } from "../../document-view/editor-view-kit";

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

it("a table pasted on a new line takes that line, and one pasted in a cell fills the cells from it", async () => {
  const t = await open();
  t.type("Before");
  t.press("Enter");
  t.paste("| a | b |\n| - | - |\n| c | d |");
  expect(texts(t.view.dom, ":scope > p")).toEqual(["Before"]);
  t.caretAt("d", 1);
  t.paste("| p | q |\n| - | - |\n| r | s |");
  expect(all(t.view.dom, "table")).toHaveLength(1);
  expect(texts(t.view.dom, "tr")).toEqual(["ab", "cpq", "rs"]);
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
