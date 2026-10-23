// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { editorViewCtx, serializerCtx } from "@milkdown/kit/core";
import type { Editor } from "@milkdown/kit/core";
import type { Ctx } from "@milkdown/kit/ctx";
import { createTestEditor } from "../../document-view/editor-test-harness";
import { usePendingEdits } from "./usePendingEdits";
import { locateHunks } from "./sentence-locate";
import { diffSentences } from "./unit-diff";
import { pendingEditKey } from "./pending-edit-plugin";
import { serializeBlocks } from "../doc-markdown";

// Two of five sentences changed: decided sentence by sentence (a
// paragraph most of whose sentences changed is one change).
const KEPT = "黛玉也不说破。二人从此相识。";
const NOTE =
  "这一句其实是在呼应第一回，可以说是一个起点。宝玉初见黛玉便觉似曾相识。贾母一句胡说，轻轻带过。" +
  KEPT;
const REWRITE =
  "这一句呼应第一回，是一个起点。宝玉初见黛玉便觉眼熟。贾母一句胡说，轻轻带过。" +
  KEPT;

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

function runner(e: Editor) {
  return <T>(fn: (ctx: Ctx) => T) => e.action(fn);
}

function markdown(e: Editor) {
  return e.action((ctx) =>
    ctx.get(serializerCtx)(ctx.get(editorViewCtx).state.doc),
  );
}

async function setup() {
  editor = await createTestEditor(`# 笔记\n\n${NOTE}\n`);
  const e = editor;
  const hook = renderHook(() => usePendingEdits(runner(e)));
  // The id the model names the paragraph by.
  const block = e.action(
    (ctx) => serializeBlocks(ctx, ctx.get(editorViewCtx).state.doc)[1].id,
  );
  // The plugin reports its previews through the editor's callback, which
  // the harness leaves empty: read them back from the plugin itself.
  const sync = () =>
    act(() =>
      hook.result.current.syncFromPlugin(
        e.action(
          (ctx) =>
            pendingEditKey.getState(ctx.get(editorViewCtx).state)?.previews ??
            [],
        ),
      ),
    );
  act(() =>
    hook.result.current.showPreviews(
      [
        {
          callId: "c1",
          proposal: { action: "replace", block, anchor: NOTE, text: REWRITE },
        },
      ],
      null,
    ),
  );
  sync();
  return { hook, sync, e };
}

describe("a rewrite decided sentence by sentence", () => {
  it("finds each changed sentence in the text", async () => {
    const { hook, e } = await setup();
    const changes = hook.result.current.sentences("c1");
    expect(changes).toHaveLength(2);
    const texts = e.action((ctx) => {
      const { doc } = ctx.get(editorViewCtx).state;
      return changes!.map((c) => doc.textBetween(c.from, c.to));
    });
    expect(texts).toEqual([
      "这一句其实是在呼应第一回，可以说是一个起点。",
      "宝玉初见黛玉便觉似曾相识。",
    ]);
    expect(hook.result.current.reviewStops).toHaveLength(2);
    expect(hook.result.current.reviewCount).toEqual({ taken: 2, total: 2 });
  });

  it("applies once every sentence has a decision, keeping what was kept", async () => {
    const { hook, sync, e } = await setup();
    act(() => hook.result.current.decide("c1", 0, false));
    sync();
    expect(hook.result.current.reviewCount).toEqual({ taken: 1, total: 2 });
    expect(markdown(e)).toContain(NOTE);
    act(() => hook.result.current.decide("c1", 1, true));
    sync();
    expect(markdown(e)).toContain(
      "这一句其实是在呼应第一回，可以说是一个起点。宝玉初见黛玉便觉眼熟。贾母一句胡说，轻轻带过。" +
        KEPT,
    );
    expect(hook.result.current.status("c1")).toBe("accepted");
  });

  it("Accept takes the undecided sentences", async () => {
    const { hook, sync, e } = await setup();
    act(() => hook.result.current.decide("c1", 1, false));
    sync();
    act(() => {
      hook.result.current.accept("c1");
    });
    expect(markdown(e)).toContain(
      "这一句呼应第一回，是一个起点。宝玉初见黛玉便觉似曾相识。贾母一句胡说，轻轻带过。" +
        KEPT,
    );
  });

  it("keeping every sentence is a rejection", async () => {
    const { hook, sync, e } = await setup();
    act(() => hook.result.current.decide("c1", 0, false));
    sync();
    act(() => hook.result.current.decide("c1", 1, false));
    sync();
    expect(markdown(e)).toContain(NOTE);
    expect(hook.result.current.status("c1")).toBe("rejected");
  });
});

describe("locateHunks", () => {
  it("finds a rewrite across paragraphs past the words before its anchor", async () => {
    editor = await createTestEditor("Keep. One. Two.\n\nThree. Four.\n");
    const result = editor.action((ctx) => {
      const { doc } = ctx.get(editorViewCtx).state;
      const hunks = diffSentences("One. Two.\n\nThree.", "One. 2.\n\nIII.");
      const ranges = locateHunks(
        doc,
        0,
        doc.content.size,
        hunks,
        // As the parser's textContent: paragraphs run together.
        (md) => md.replace(/\n+/g, ""),
        "Keep. ",
      );
      return ranges?.map((r) => doc.textBetween(r.from, r.to));
    });
    // "One." stays; the two changes, too unalike to pair, are one change
    // for each paragraph they are in.
    expect(result).toEqual(["One.", "Two.", "Three."]);
  });

  it("gives up when the words before the anchor aren't where it starts", async () => {
    editor = await createTestEditor("One. Two.\n");
    const result = editor.action((ctx) => {
      const { doc } = ctx.get(editorViewCtx).state;
      const hunks = diffSentences("Two.", "2.");
      return locateHunks(
        doc,
        0,
        doc.content.size,
        hunks,
        (md) => md,
        "Missing. ",
      );
    });
    expect(result).toBeNull();
  });

  it("gives up when a piece is not next in the text", async () => {
    editor = await createTestEditor("One. Two. Three.\n");
    const result = editor.action((ctx) => {
      const { doc } = ctx.get(editorViewCtx).state;
      const hunks = diffSentences("One. Missing. Three.", "One. New. Three.");
      return locateHunks(doc, 0, doc.content.size, hunks, (md) => md);
    });
    expect(result).toBeNull();
  });
});
