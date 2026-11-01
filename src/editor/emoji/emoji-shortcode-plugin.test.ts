// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  closeViews,
  openView,
  type TestView,
} from "../../document-view/editor-view-kit";
import { emojiNames } from "./emoji-shortcode-plugin";

afterEach(closeViews);
beforeAll(() => emojiNames.load());

const shown = (t: TestView) =>
  [...t.view.dom.querySelectorAll(".md-emoji")].map((el) => el.textContent);

describe(":shortcode: emoji", () => {
  it("shows a known shortcode as its emoji and saves it as written", async () => {
    const source = "Ship it :rocket: :tada: :+1:";
    const t = await openView(source);
    t.select(1);
    expect(shown(t)).toEqual(["🚀", "🎉", "👍"]);
    expect(t.view.dom.querySelectorAll(".md-emoji-source")).toHaveLength(3);
    expect(t.markdown()).toBe(source);
  });

  it("leaves unknown names, times and code alone", async () => {
    const t = await openView("At 10:30:00 :not_an_emoji: `:smile:`");
    t.select(1);
    expect(shown(t)).toEqual([]);
  });

  it("leaves a code block alone", async () => {
    const t = await openView("```\n:smile:\n```\n\nafter");
    expect(shown(t)).toEqual([]);
  });

  it("shows the source of the shortcode the caret is on", async () => {
    const t = await openView("a :smile: b :tada:");
    t.caretAtEnd();
    expect(shown(t)).toEqual(["😄"]);
    t.select(1);
    expect(shown(t)).toEqual(["😄", "🎉"]);
  });

  it("shows a shortcode's source when its emoji is clicked", async () => {
    const t = await openView("a :smile: b");
    t.select(1);
    // jsdom has no layout, which ProseMirror's own mouse handling reads.
    if (!("elementFromPoint" in document))
      Object.assign(document, { elementFromPoint: () => null });
    const emoji = t.view.dom.querySelector(".md-emoji")!;
    emoji.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );
    expect(shown(t)).toEqual([]);
    expect(t.caretLine()).toBe("a :|smile: b");
  });

  it("draws a shortcode once it is typed and the caret moves on", async () => {
    const t = await openView("");
    t.type("hi :wave:");
    expect(shown(t)).toEqual([]);
    t.type(" there");
    expect(shown(t)).toEqual(["👋"]);
    expect(t.markdown()).toBe("hi :wave: there");
  });
});
