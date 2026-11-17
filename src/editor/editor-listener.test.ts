// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  Editor,
  defaultValueCtx,
  editorViewCtx,
  rootCtx,
} from "@milkdown/kit/core";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { listener, listenerCtx } from "./editor-listener";

let editor: Editor | null = null;
afterEach(async () => {
  await editor?.destroy();
  editor = null;
  vi.useRealTimers();
});

it("tells of a change once typing rests, Markdown only to who asks", async () => {
  vi.useFakeTimers();
  const updated = vi.fn();
  const markdown = vi.fn();
  const mounted = vi.fn();
  const root = document.createElement("div");
  document.body.appendChild(root);
  editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root);
      ctx.set(defaultValueCtx, "Hello");
      ctx
        .get(listenerCtx)
        .mounted(mounted)
        .updated(updated)
        .markdownUpdated((_ctx, text) => markdown(text));
    })
    .use(commonmark)
    .use(listener)
    .create();
  expect(mounted).toHaveBeenCalledOnce();
  const view = editor.ctx.get(editorViewCtx);
  view.dispatch(view.state.tr.insertText(" world", 6));
  view.dispatch(view.state.tr.insertText("!", 12));
  expect(updated).not.toHaveBeenCalled();
  vi.advanceTimersByTime(250);
  expect(updated).toHaveBeenCalledOnce();
  expect(markdown).toHaveBeenCalledWith("Hello world!\n");
  // Nothing that leaves the history out (an editor's own bookkeeping).
  view.dispatch(
    view.state.tr.insertText("?", 13).setMeta("addToHistory", false),
  );
  vi.advanceTimersByTime(250);
  expect(updated).toHaveBeenCalledOnce();
});
