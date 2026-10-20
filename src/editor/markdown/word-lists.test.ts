// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { wordListsToHtml } from "./word-lists";

const item = (list: string, level: number, bullet: string, text: string) =>
  `<p class=MsoListParagraph style='mso-list:${list} level${level} lfo1'><span style='mso-list:Ignore'>${bullet}<span>&nbsp; </span></span>${text}</p>`;

/** The HTML's text, with its lists as tags around it. */
const shape = (html: string) =>
  html.replace(/<(\/?)(ul|ol|li)>/g, "[$1$2]").replace(/<[^>]+>/g, "");

describe("wordListsToHtml", () => {
  it("makes Word's list paragraphs a list, its bullets gone", () => {
    expect(
      shape(wordListsToHtml(item("l0", 1, "·", "a") + item("l0", 1, "·", "b"))),
    ).toBe("[ul][li]a[/li][li]b[/li][/ul]");
  });

  it("nests a deeper level in the item before it", () => {
    expect(
      shape(
        wordListsToHtml(
          item("l0", 1, "·", "a") +
            item("l0", 2, "o", "b") +
            item("l0", 1, "·", "c"),
        ),
      ),
    ).toBe("[ul][li]a[ul][li]b[/li][/ul][/li][li]c[/li][/ul]");
  });

  it("numbers an ordered one, and starts a new list for another list or after a paragraph", () => {
    expect(
      shape(
        wordListsToHtml(
          item("l0", 1, "·", "a") +
            item("l1", 1, "1.", "b") +
            "<p>text</p>" +
            item("l1", 1, "2.", "c"),
        ),
      ),
    ).toBe("[ul][li]a[/li][/ul][ol][li]b[/li][/ol]text[ol][li]c[/li][/ol]");
  });

  it("finds the bullet in the text when its span is gone", () => {
    expect(
      shape(
        wordListsToHtml(
          "<p style='mso-list:l0 level1 lfo1'>·&nbsp;&nbsp; a</p>",
        ),
      ),
    ).toBe("[ul][li]a[/li][/ul]");
  });

  it("leaves other HTML as it is", () => {
    const html = "<p>Hello <b>world</b></p>";
    expect(wordListsToHtml(html)).toBe(html);
  });
});
