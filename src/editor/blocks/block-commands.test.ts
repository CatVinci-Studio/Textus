// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { closeViews, openView, type TestView } from "../editor-view-kit";
import {
  blockAround,
  deleteBlock,
  duplicateBlock,
  gapsFor,
  moveTo,
  type HandledBlock,
} from "./block-commands";

afterEach(closeViews);

/** The handled block holding `text`. */
function blockOf(v: TestView, text: string): HandledBlock {
  return blockAround(v.view.state.doc, v.caretAt(text))!;
}

const run = (v: TestView, tr: ReturnType<typeof deleteBlock> | null) => {
  if (tr) v.view.dispatch(tr);
};

/** The gap before the block holding `text`. */
const gapBefore = (v: TestView, text: string) => blockOf(v, text).pos;

describe("a block's handle", () => {
  it("stands for a list item with what is nested in it, else the block, a quote whole", async () => {
    const v = await openView("Intro\n\n- one\n  - inner\n- two\n\n> quoted\n");
    expect(blockOf(v, "Intro").node.type.name).toBe("paragraph");
    const one = blockOf(v, "one");
    expect(one.node.type.name).toBe("list_item");
    expect(one.node.textContent).toBe("oneinner");
    expect(blockOf(v, "quoted").node.type.name).toBe("blockquote");
  });

  it("moves a block where it is let go, one undo step, its source kept as written", async () => {
    const v = await openView("Title\n=====\n\nFirst.\n\nSecond.\n");
    run(
      v,
      moveTo(v.view.state, blockOf(v, "Title"), v.view.state.doc.content.size),
    );
    expect(v.markdown()).toBe("First.\n\nSecond.\n\nTitle\n=====");
    v.press("Mod+z");
    expect(v.markdown()).toBe("Title\n=====\n\nFirst.\n\nSecond.");
  });

  it("moves a list item with its children, and out of the list into one of its own", async () => {
    const v = await openView("* a\n  * a1\n* b\n\nAfter.\n");
    run(
      v,
      moveTo(
        v.view.state,
        blockOf(v, "a"),
        gapBefore(v, "b") + blockOf(v, "b").node.nodeSize,
      ),
    );
    expect(v.markdown()).toBe("* b\n* a\n  * a1\n\nAfter.");
    run(
      v,
      moveTo(v.view.state, blockOf(v, "b"), v.view.state.doc.content.size),
    );
    expect(v.markdown()).toBe("* a\n  * a1\n\nAfter.\n\n* b");
  });

  it("takes a list along when its only item leaves", async () => {
    const v = await openView("Top.\n\n- only\n\nEnd.\n");
    run(v, moveTo(v.view.state, blockOf(v, "only"), 0));
    expect(v.markdown()).toBe("- only\n\nTop.\n\nEnd.");
  });

  it("offers no gap inside or beside itself", async () => {
    const v = await openView("A\n\nB\n\nC\n");
    const b = blockOf(v, "B");
    const gaps = gapsFor(v.view.state.doc, b).map((gap) => gap.pos);
    expect(gaps).not.toContain(b.pos + 1);
    expect(moveTo(v.view.state, b, b.pos)).toBeNull();
  });

  it("offers a list item its list's ends, not a second place just outside them", async () => {
    const v = await openView("Top.\n\n- one\n- two\n\nEnd.\n");
    const one = blockOf(v, "one");
    const list = v.view.state.doc.child(1);
    const listAt = v.view.state.doc.child(0).nodeSize;
    const gaps = gapsFor(v.view.state.doc, one).map((gap) => gap.pos);
    expect(gaps).not.toContain(listAt);
    expect(gaps).not.toContain(listAt + list.nodeSize);
    expect(gaps).toContain(listAt + list.nodeSize - 1);
    // A paragraph still goes either side of the list.
    const top = gapsFor(v.view.state.doc, blockOf(v, "Top.")).map((g) => g.pos);
    expect(top).toContain(listAt + list.nodeSize);
  });

  it("deletes and duplicates, each one undo step", async () => {
    const v = await openView("Keep.\n\nGo.\n\n- item\n");
    run(v, deleteBlock(v.view.state, blockOf(v, "Go.")));
    expect(v.markdown()).toBe("Keep.\n\n- item");
    run(v, duplicateBlock(v.view.state, blockOf(v, "Keep.")));
    expect(v.markdown()).toBe("Keep.\n\nKeep.\n\n- item");
    v.press("Mod+z");
    expect(v.markdown()).toBe("Keep.\n\n- item");
  });

  it("leaves a line to write on when the last block goes", async () => {
    const v = await openView("Only.\n");
    run(v, deleteBlock(v.view.state, blockOf(v, "Only.")));
    expect(v.view.state.doc.childCount).toBe(1);
    expect(v.markdown()).toBe("");
  });
});
