// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { editorViewCtx, type Editor } from "@milkdown/kit/core";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { createTestEditor } from "../../editor/editor-test-kit";
import { metaDecorations } from "../../editor/meta-decorations";
import { askAtRest } from "./rest-asking";

vi.mock("mermaid", () => ({
  default: { initialize() {}, render: () => new Promise(() => {}) },
}));

let editor: Editor | null = null;
afterEach(async () => {
  vi.useRealTimers();
  await editor?.destroy();
  editor = null;
});

type Answer = { block: string; plugin: string };

it("keeps what a late plugin drew before, and asks it once more", async () => {
  editor = await createTestEditor("One\n\nTwo\n");
  const ctx = editor.ctx;
  const view = ctx.get(editorViewCtx);
  const key = new PluginKey<DecorationSet>("asked");
  view.updateState(
    view.state.reconfigure({
      plugins: [
        ...view.state.plugins,
        new Plugin({ key, state: metaDecorations(key) }),
      ],
    }),
  );
  const marks = () => (key.getState(view.state) ?? DecorationSet.empty).find();
  vi.useFakeTimers();
  // First on time, then too late (the page busy), then on time again.
  const replies = [false, true, false];
  const ask = vi.fn(async (blocks: { id: string }[]) => ({
    answers: replies[0] ? [] : [{ block: blocks[0].id, plugin: "p" }],
    late: replies.shift() ? ["p"] : [],
  }));
  const asking = askAtRest<Answer>(
    ctx,
    view,
    { current: null },
    {
      key,
      active: () => true,
      subscribe: () => () => {},
      ask,
      draw: (block, pos, answer) => [
        Decoration.inline(
          pos + 1,
          pos + block.nodeSize - 1,
          {},
          {
            plugin: answer.plugin,
          },
        ),
      ],
    },
  );
  await vi.advanceTimersByTimeAsync(500);
  expect(marks()).toHaveLength(1);
  // Asked again (a scroll, say): late this time, so the mark stays...
  const before = view.state;
  view.dispatch(view.state.tr.insertText("!", 1));
  asking.update?.(view, before);
  await vi.advanceTimersByTimeAsync(500);
  expect(marks()).toHaveLength(1);
  // ...and it is asked once more by itself.
  await vi.advanceTimersByTimeAsync(500);
  expect(ask).toHaveBeenCalledTimes(3);
  expect(marks()).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(2000);
  expect(ask).toHaveBeenCalledTimes(3);
  asking.destroy?.();
});
