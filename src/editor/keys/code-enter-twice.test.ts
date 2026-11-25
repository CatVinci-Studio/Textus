// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { closeViews, openView } from "../editor-view-kit";

// Settings › Editor › "Press Enter twice to leave a code block".

afterEach(closeViews);

const twoEnters = async (codeEnterTwiceLeaves: boolean) => {
  const t = await openView("```js\nlet x\n```", {
    enableCompletion: false,
    codeEnterTwiceLeaves,
  });
  t.select(t.view.state.doc.child(0).nodeSize - 1);
  t.press("Enter");
  t.press("Enter");
  return t;
};

it("on, two Enters at a code block's end leave it", async () => {
  const t = await twoEnters(true);
  expect(t.view.state.doc.child(0).textContent).toBe("let x");
  expect(t.view.state.selection.$from.parent.type.name).toBe("paragraph");
});

it("off, they are two new lines in the block", async () => {
  const t = await twoEnters(false);
  expect(t.view.state.doc.child(0).textContent).toBe("let x\n\n");
  expect(t.view.state.selection.$from.parent.type.name).toBe("code_block");
});
