// @vitest-environment jsdom

import { afterEach, expect, it, vi } from "vitest";

const moves: { el: Element; frames: Keyframe[] }[] = [];
vi.mock("../../engine/motion/motion", async (real) => ({
  ...(await real<typeof import("../../engine/motion/motion")>()),
  motionAllowed: () => true,
  animate: (el: Element, frames: Keyframe[]) => {
    moves.push({ el, frames });
    return null;
  },
}));
const { addBlockFold } = await import("./block-fold");

afterEach(() => {
  vi.restoreAllMocks();
  moves.length = 0;
  document.body.replaceChildren();
});

it("a drawn block folded to its line, what follows glides up into its room", () => {
  const editor = document.createElement("div");
  editor.className = "ProseMirror";
  editor.innerHTML = "<p>before</p><div>diagram</div><p>after</p>";
  document.body.append(editor);
  const block = editor.children[1] as HTMLElement;
  // jsdom lays nothing out: the block is 200 px tall open, 30 px folded.
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      const tall = (el: Element) =>
        el === block ? (block.hasAttribute("data-folded") ? 30 : 200) : 20;
      let top = 0;
      for (const el of editor.children) {
        if (el === this) break;
        top += tall(el);
      }
      const height = editor.contains(this) ? tall(this) : 0;
      return {
        top,
        bottom: top + height,
        left: 0,
        width: 600,
        height,
      } as DOMRect;
    },
  );
  addBlockFold(block, "Diagram", "doc|0");
  block.querySelector<HTMLElement>(".block-fold")!.click();
  const after = moves.find((m) => m.el.textContent === "after");
  expect(after?.frames[0]).toEqual({ transform: "translate(0px, 170px)" });
});
