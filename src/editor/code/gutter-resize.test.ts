// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Editor } from "@milkdown/kit/core";
import { createTestEditor } from "../editor-test-kit";

const fitGutter = vi.hoisted(() => vi.fn());
vi.mock("./gutter-fit", () => ({ fitGutter }));
vi.mock("mermaid", () => ({
  default: { initialize() {}, render: () => new Promise(() => {}) },
}));
const css = (globalThis.CSS ?? {}) as { escape?: (value: string) => string };
css.escape ??= (value) => value.replace(/["\\]/g, "\\$&");
(globalThis as { CSS?: unknown }).CSS = css;

const observers: Array<{ target: Element; resized: () => void }> = [];
class FakeResizeObserver {
  constructor(private callback: (entries: unknown[]) => void) {}
  observe(target: Element) {
    observers.push({
      target,
      resized: () => this.callback([{ target, contentRect: { width: 0 } }]),
    });
  }
  unobserve() {}
  disconnect() {}
}

const editors: Editor[] = [];
afterEach(async () => {
  await Promise.all(editors.splice(0).map((editor) => editor.destroy()));
  vi.unstubAllGlobals();
  observers.length = 0;
});

describe("a numbered code block's gutter", () => {
  it("fits its lines in the observer's own turn, before the frame is drawn", async () => {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    editors.push(
      await createTestEditor("```js\nconst a = 1;\nconst b = 2;\n```\n", {
        codeLineNumbers: true,
      }),
    );
    expect(document.querySelector(".code-line-gutter")).not.toBeNull();
    fitGutter.mockClear();
    // The block's width changed and its lines wrap differently: a frame
    // later, the numbers showed beside the wrong lines for that frame.
    for (const { target, resized } of observers)
      if (target.tagName === "CODE") resized();
    expect(fitGutter).toHaveBeenCalled();
  });
});
