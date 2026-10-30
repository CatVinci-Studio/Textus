// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { editorViewCtx, type Editor } from "@milkdown/kit/core";
import type { Ctx } from "@milkdown/kit/ctx";
import { undo } from "@milkdown/kit/prose/history";
import { createTestEditor } from "../editor-test-harness";
import { documentChangedForPlugins } from "./plugin-events";
import { applyPluginEdits, replaceDocument } from "./plugin-edits";
import { markChangeSource } from "../../editor/change-source";
import { onPluginEvent } from "../../plugins/app-bridge";

let editor: Editor | null = null;
let stop: (() => void) | null = null;
afterEach(async () => {
  stop?.();
  await editor?.destroy();
  editor = null;
});

/** The editor, and the sources plugins are told as each change reports. */
async function setUp() {
  editor = await createTestEditor("one\n\ntwo\n");
  const told: string[] = [];
  stop = onPluginEvent("documentChange", (e) => told.push(e.source));
  const act = (change: (ctx: Ctx) => void) =>
    editor!.action((ctx) => {
      change(ctx);
      documentChangedForPlugins(true, "/notes/a.md", ctx);
    });
  return { told, act };
}

const view = (ctx: Ctx) => ctx.get(editorViewCtx);

describe("the source plugins are told of a change", () => {
  it("is the user for typing, history for undo", async () => {
    const { told, act } = await setUp();
    act((ctx) => view(ctx).dispatch(view(ctx).state.tr.insertText("!", 2)));
    act((ctx) => undo(view(ctx).state, view(ctx).dispatch));
    expect(told).toEqual(["user", "history"]);
  });

  it("is a plugin for edits through its API, and AI where Textus AI marks it", async () => {
    const { told, act } = await setUp();
    act((ctx) => applyPluginEdits(ctx, [{ action: "append", text: "three" }]));
    act((ctx) => replaceDocument(ctx, "one\n\nfour\n"));
    act((ctx) =>
      view(ctx).dispatch(
        markChangeSource(view(ctx).state.tr.insertText("ai ", 1), "ai"),
      ),
    );
    expect(told).toEqual(["plugin", "plugin", "ai"]);
  });

  it("is the user when the user and another changed it since the last report", async () => {
    const { told, act } = await setUp();
    act((ctx) => {
      applyPluginEdits(ctx, [{ action: "append", text: "three" }]);
      view(ctx).dispatch(view(ctx).state.tr.insertText("!", 2));
    });
    expect(told).toEqual(["user"]);
  });

  it("counts bookkeeping alone as the change it followed", async () => {
    const { told, act } = await setUp();
    act((ctx) =>
      view(ctx).dispatch(
        markChangeSource(view(ctx).state.tr.insertText("ai ", 1), "ai"),
      ),
    );
    act((ctx) =>
      view(ctx).dispatch(
        view(ctx).state.tr.insertText("x", 2).setMeta("addToHistory", false),
      ),
    );
    expect(told).toEqual(["ai", "ai"]);
  });

  it("is taken for a tab behind too, so it isn't told later as the front one's", async () => {
    const { told } = await setUp();
    editor!.action((ctx) => {
      applyPluginEdits(ctx, [{ action: "append", text: "three" }]);
      documentChangedForPlugins(false, "/notes/a.md", ctx);
      view(ctx).dispatch(view(ctx).state.tr.insertText("!", 2));
      documentChangedForPlugins(true, "/notes/a.md", ctx);
    });
    expect(told).toEqual(["user"]);
  });
});
