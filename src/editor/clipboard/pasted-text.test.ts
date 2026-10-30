// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { closeViews, openView } from "../../document-view/editor-view-kit";

// What a paste of text or HTML puts in the Markdown: links, lists from
// Word, and text pasted over words, into cells and into lines.

afterEach(closeViews);

const open = (markdown = "") => openView(markdown, { enableCompletion: false });

const links = (root: HTMLElement) =>
  [...root.querySelectorAll("a")].map(
    (a) => `${a.textContent} -> ${a.getAttribute("href")}`,
  );

it("a pasted URL becomes a link with the URL as its text", async () => {
  const url = "https://github.com/CatVinci-Studio/Textus/issues";
  const t = await open();
  t.paste(url);
  expect(links(t.view.dom)).toEqual([`${url} -> ${url}`]);
  expect(t.markdown()).toBe(`[${url}](${url})`);
});

it("an empty-text link shows its URL and is saved as written", async () => {
  const t = await open();
  t.paste("See [](https://x.org/a) and <https://x.org/b>");
  expect(links(t.view.dom)[0]).toBe("https://x.org/a -> https://x.org/a");
  expect(t.markdown()).toBe("See [](https://x.org/a) and <https://x.org/b>");
});

it("a copied non-image file still pastes as a link", async () => {
  const t = await open();
  t.paste(
    "/home/me/a.pdf",
    '<a href="file:///home/me/a.pdf">/home/me/a.pdf</a>',
  );
  expect(t.markdown()).toBe("[/home/me/a.pdf](file:///home/me/a.pdf)");
});

it("a URL pasted over selected words links them", async () => {
  const t = await open();
  t.paste("Read the docs today.");
  t.caretAt("docs", 0, 4);
  t.paste("https://docs.example");
  expect(t.markdown()).toBe("Read the [docs](https://docs.example) today.");
});

it("lines pasted into a table cell stay in that cell", async () => {
  const t = await open("| a | b |\n| - | - |\n| c | d |");
  t.caretAt("c", 1);
  t.paste("one\n\ntwo");
  expect(
    [...t.view.dom.querySelectorAll("td")].map((td) => td.textContent),
  ).toEqual(["cone two", "d"]);
});

it("Word's list paragraphs paste as a list, nested by level", async () => {
  const item = (level: number, list: string, bullet: string, text: string) =>
    `<p class=MsoListParagraph style='mso-list:${list} level${level} lfo1'><![if !supportLists]><span style='mso-list:Ignore'>${bullet}<span>&nbsp;&nbsp; </span></span><![endif]>${text}<o:p></o:p></p>`;
  const t = await open();
  t.paste(
    "·   one\no   nested\n·   two\n1.  first",
    "<html xmlns:o='urn:schemas-microsoft-com:office:office'><body>" +
      item(1, "l0", "·", "one") +
      item(2, "l0", "o", "nested") +
      item(1, "l0", "·", "two") +
      item(1, "l1", "1.", "first") +
      "</body></html>",
  );
  expect(t.markdown()).toBe("* one\n  * nested\n* two\n\n1. first");
});

it("a heading pasted into the middle of a line keeps its #", async () => {
  const t = await open();
  t.paste("Before after.");
  t.caretAt("Before after.", 7);
  t.paste("# Title ");
  expect(t.markdown()).toBe("Before # Title after.");
});
