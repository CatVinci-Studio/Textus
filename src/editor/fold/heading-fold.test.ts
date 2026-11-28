// @vitest-environment jsdom

import { editorViewCtx, type Editor } from "@milkdown/kit/core";
import type { EditorView } from "@milkdown/kit/prose/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const moves: { el: Element; frames: Keyframe[] }[] = [];
vi.mock("../../engine/motion/motion", async (real) => ({
  ...(await real<typeof import("../../engine/motion/motion")>()),
  motionAllowed: () => true,
  length: () => 4,
  animate: (el: Element, frames: Keyframe[]) => {
    moves.push({ el, frames });
    return null;
  },
}));
const { createTestEditor } = await import("../editor-test-kit");

let editor: Editor | null = null;

/** jsdom lays nothing out: each block 20 px under the last, a folded-away
 *  one taking no room. */
beforeEach(() => {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      const pm = this.parentElement;
      const shown = pm
        ? [...pm.children].filter(
            (el) => !el.classList.contains("heading-folded-away"),
          )
        : [];
      const i = shown.indexOf(this);
      const top = i * 20;
      return (
        i < 0
          ? { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }
          : {
              top,
              bottom: top + 20,
              left: 0,
              right: 600,
              width: 600,
              height: 20,
            }
      ) as DOMRect;
    },
  );
});
afterEach(async () => {
  vi.restoreAllMocks();
  moves.length = 0;
  await editor?.destroy();
  editor = null;
});

type Toggle = (view: EditorView, pos: number) => void;
const toggleOf = (view: EditorView) =>
  view.state.plugins
    .map((plugin) => (plugin.spec as { toggle?: Toggle }).toggle)
    .find(Boolean)!;

const moveOf = (text: string) =>
  moves.find((m) => m.el.textContent === text)?.frames[0];

describe("folding a heading", () => {
  it("glides the blocks below into its section's room, and back as it opens", async () => {
    editor = await createTestEditor("## One\n\nbody\n\n## Two\n\ntail");
    const view = editor.ctx.get(editorViewCtx);
    const toggle = toggleOf(view);
    toggle(view, 0);
    // "Two" stood at 40, under the folded body, and now lies at 20.
    expect(moveOf("Two")).toEqual({ transform: "translate(0px, 20px)" });
    expect(moveOf("tail")).toEqual({ transform: "translate(0px, 20px)" });
    moves.length = 0;
    toggle(view, 0);
    expect(moveOf("Two")).toEqual({ transform: "translate(0px, -20px)" });
    // What it opened comes in under the heading, not from where it was
    // hidden.
    const body = moves.filter((m) => m.el.textContent === "body");
    expect(body.map((m) => m.frames[0])).toEqual([
      { opacity: 0, transform: "translateY(-4px)" },
    ]);
  });
});
