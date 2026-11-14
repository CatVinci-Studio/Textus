// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { closeViews, openView } from "../../editor/editor-view-kit";
import "./editor-extensions";
import {
  addPasteHandler,
  forgetPasteHandlers,
  pastePattern,
} from "./paste-handlers";

afterEach(async () => {
  forgetPasteHandlers("a.one");
  forgetPasteHandlers("b.two");
  await closeViews();
});

/** What pasting `text` after "one" saves, once the plugins answered. */
async function pasted(text: string): Promise<string> {
  const t = await openView("one", { enableCompletion: false });
  t.caretAtEnd();
  t.paste(text);
  await new Promise((resolve) => setTimeout(resolve, 20));
  return t.markdown();
}

describe("a plugin's paste handler", () => {
  it("puts its Markdown in for the text its pattern takes", async () => {
    addPasteHandler(
      "a.one",
      "1",
      pastePattern("^ISBN \\d+$"),
      async (t) => `**${t}**`,
    );
    expect(await pasted("ISBN 123")).toContain("one**ISBN 123**");
  });

  it("lets the paste go on when it answers nothing, and the next plugin may", async () => {
    addPasteHandler("a.one", "1", pastePattern("^ISBN"), async () => null);
    expect(await pasted("ISBN 9")).toBe("oneISBN 9");
    addPasteHandler("b.two", "1", pastePattern("^ISBN"), async () => "*b*");
    expect(await pasted("ISBN 7")).toContain("one*b*");
  });

  it("is never asked about text its pattern doesn't take", async () => {
    let asked = 0;
    addPasteHandler("a.one", "1", pastePattern("^ISBN"), async () => {
      asked++;
      return "x";
    });
    expect(await pasted("two")).toBe("onetwo");
    expect(asked).toBe(0);
  });

  it("refuses a pattern that isn't one", () => {
    expect(() => pastePattern("(")).toThrow();
  });
});
