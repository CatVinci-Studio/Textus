// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { TextSelection } from "@milkdown/kit/prose/state";
import { closeViews, openView } from "../editor-view-kit";
import { redirectMisattributedInput } from "./enclosure";

afterEach(closeViews);

describe("input that lands inside a link's source", () => {
  // "ab ", then the link [c](u) from 4 to 12, then " de".
  async function typedAtLinkEnd(caret: number) {
    const t = await openView("ab [c](u) de", { enableCompletion: false });
    const { view } = t;
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, caret)),
    );
    const handled = redirectMisattributedInput(view, 11, 11, "x");
    return { handled, text: view.state.doc.textContent };
  }

  it("goes where the caret is when the caret is just outside it", async () => {
    expect(await typedAtLinkEnd(12)).toEqual({
      handled: true,
      text: "ab [c](u)x de",
    });
  });

  it("is left alone when the caret is elsewhere, a click not yet read", async () => {
    expect(await typedAtLinkEnd(2)).toEqual({
      handled: false,
      text: "ab [c](u) de",
    });
  });
});

describe("input that lands inside raw HTML", () => {
  it("a typed closer over the autopair's ')' just after it goes in once", async () => {
    const t = await openView("", { enableCompletion: false });
    t.type("(<b>");
    // As WebKit and Chromium report it: inside the tag, the caret just after.
    const caret = t.view.state.selection.from;
    expect(redirectMisattributedInput(t.view, caret - 1, caret - 1, ")")).toBe(
      true,
    );
    t.type(" c");
    expect(t.markdown()).toBe("(<b>) c");
  });
});
