// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { editorViewCtx, type Editor } from "@milkdown/kit/core";
import { createTestEditor } from "./editor-test-kit";

const render = vi.hoisted(() =>
  vi.fn(async (id: string) => ({ svg: `<svg id="${id}"></svg>` })),
);
vi.mock("mermaid", () => ({ default: { initialize() {}, render } }));
const css = (globalThis.CSS ?? {}) as { escape?: (value: string) => string };
css.escape ??= (value) => value.replace(/["\\]/g, "\\$&");
(globalThis as { CSS?: unknown }).CSS = css;

// Laid out as a column: jsdom has no layout, and an editor of no width
// waits to be shown before it draws.
Object.defineProperty(HTMLElement.prototype, "clientWidth", {
  configurable: true,
  get: () => 800,
});

// The browser reports a new editor laid out a frame or so after it is
// made: until then, what it shows is what its first state decorated.
class LaidOut {
  constructor(private callback: (entries: unknown[]) => void) {}
  observe(target: Element) {
    setTimeout(
      () => this.callback([{ target, contentRect: { width: 800 } }]),
      100,
    );
  }
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", LaidOut);

const DOC = "Before\n\n```mermaid\ngraph LR\n  A --> B\n```\n\nAfter\n";
const editors: Editor[] = [];
afterEach(async () => {
  await Promise.all(editors.splice(0).map((editor) => editor.destroy()));
});

const shown = (editor: Editor) =>
  editor.action((ctx) =>
    ctx.get(editorViewCtx).dom.querySelector(".mermaid-preview"),
  );

describe("a diagram in a tab made again", () => {
  it("shows its drawing at once, not its source and then the drawing", async () => {
    const first = await createTestEditor(DOC, { diagramEngine: "mermaid" });
    editors.push(first);
    await vi.waitFor(() => expect(shown(first)).not.toBeNull());
    expect(render).toHaveBeenCalledTimes(1);
    await first.destroy();
    editors.length = 0;

    const again = await createTestEditor(DOC, { diagramEngine: "mermaid" });
    editors.push(again);
    expect(shown(again)).not.toBeNull();
    // Its first pass finds the same drawing: nothing drawn twice.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(render).toHaveBeenCalledTimes(1);
  });
});
