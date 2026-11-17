// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { closeViews, openView, type TestView } from "./editor-view-kit";
import { movedText } from "./text-drag-plugin";

afterEach(closeViews);

/** "word" in the document: its start and end. */
function range(v: TestView, word: string) {
  const from = v.caretAt(word);
  return { from, to: from + word.length };
}

describe("selected text pulled elsewhere", () => {
  it("moves later or earlier, selected where it lands, one undo step", async () => {
    const v = await openView("one two three\n\nfour five\n");
    const two = range(v, "two ");
    v.view.dispatch(
      movedText(v.view.state, two.from, two.to, v.caretAt("five"), false)!,
    );
    expect(v.markdown()).toBe("one three\n\nfour two five");
    expect(v.selected()).toBe("two ");
    v.press("Mod+z");
    expect(v.markdown()).toBe("one two three\n\nfour five");
    const five = range(v, "five");
    v.view.dispatch(
      movedText(v.view.state, five.from, five.to, v.caretAt("one"), false)!,
    );
    expect(v.markdown()).toBe("fiveone two three\n\nfour");
  });

  it("copies with the modifier, and goes nowhere let go on itself", async () => {
    const v = await openView("alpha beta\n");
    const beta = range(v, "beta");
    v.view.dispatch(
      movedText(v.view.state, beta.from, beta.to, v.caretAt("alpha"), true)!,
    );
    expect(v.markdown()).toBe("betaalpha beta");
    const again = range(v, "alpha");
    expect(
      movedText(v.view.state, again.from, again.to, again.from + 2, false),
    ).toBeNull();
  });
});
