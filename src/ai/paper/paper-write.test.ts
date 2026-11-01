// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { undo } from "@milkdown/kit/prose/history";
import { closeViews, openView } from "../../document-view/editor-view-kit";
import { beginPaper, settlePaper, writePaper } from "./paper-write";
import { paperRegion } from "./paper-region-plugin";

afterEach(closeViews);

describe("a paper written into the document", () => {
  it("takes an empty document whole, with no blank line above it", async () => {
    const t = await openView("");
    const original = beginPaper(t.view);
    t.editor.action((ctx) => writePaper(t.view, ctx, "# Roofs\n\n## Cooling"));
    expect(t.markdown()).toBe("# Roofs\n\n## Cooling");
    t.editor.action((ctx) =>
      writePaper(t.view, ctx, "# Roofs\n\n## Cooling\n\nPlants shade."),
    );
    expect(t.markdown()).toBe("# Roofs\n\n## Cooling\n\nPlants shade.");
    t.editor.action((ctx) =>
      settlePaper(t.view, ctx, "# Green roofs\n\nPlants shade.", original),
    );
    expect(t.markdown()).toBe("# Green roofs\n\nPlants shade.");
    expect(paperRegion(t.view.state)).toBeNull();
    // One Undo takes the whole paper out.
    undo(t.view.state, t.view.dispatch);
    expect(t.markdown()).toBe("");
  });

  it("goes after what the document has, and follows the user's edits above it", async () => {
    const t = await openView("Notes.");
    const original = beginPaper(t.view);
    t.editor.action((ctx) => writePaper(t.view, ctx, "## One\n\nA."));
    // Typed into the user's own paragraph while the paper is written.
    t.select(1);
    t.type("My ");
    t.editor.action((ctx) => writePaper(t.view, ctx, "## One\n\nA, then B."));
    expect(t.markdown()).toBe("My Notes.\n\n## One\n\nA, then B.");
    t.editor.action((ctx) =>
      settlePaper(t.view, ctx, "## One\n\nA, then B, done.", original),
    );
    expect(t.markdown()).toBe("My Notes.\n\n## One\n\nA, then B, done.");
    undo(t.view.state, t.view.dispatch);
    expect(t.markdown()).toBe("My Notes.");
  });

  it("rewrites only the blocks that changed", async () => {
    const t = await openView("");
    beginPaper(t.view);
    t.editor.action((ctx) => writePaper(t.view, ctx, "## One\n\nA.\n\n## Two"));
    const heading = t.view.state.doc.child(0);
    t.editor.action((ctx) =>
      writePaper(t.view, ctx, "## One\n\nA.\n\n## Two\n\nB."),
    );
    // The same node, so its DOM is left as drawn.
    expect(t.view.state.doc.child(0)).toBe(heading);
  });
});
