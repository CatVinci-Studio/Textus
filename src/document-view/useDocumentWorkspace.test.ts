// @vitest-environment jsdom
import { act, renderHook, cleanup } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { editorViewCtx, serializerCtx, type Editor } from "@milkdown/kit/core";
import { createTestEditor } from "./editor-test-harness";
import { useDocumentWorkspace } from "./useDocumentWorkspace";
import type { EditorRunner } from "../editor/useEditorRunner";
import { TextSelection } from "@milkdown/kit/prose/state";

let editor: Editor | undefined;
afterEach(async () => {
  cleanup();
  await editor?.destroy();
  editor = undefined;
});
it("retains the request selection when partially accepting after a selection-only move", async () => {
  editor = await createTestEditor("Alpha.\n\nBeta.");
  const run: EditorRunner = (fn) => editor!.action(fn);
  run((ctx) => {
    const v = ctx.get(editorViewCtx);
    v.dispatch(
      v.state.tr.setSelection(TextSelection.create(v.state.doc, 1, 7)),
    );
  });
  const { result } = renderHook(() => useDocumentWorkspace(run, "doc"));
  act(() => {
    result.current.begin("edit", "session");
    result.current.receive([
      { callId: "append", proposal: { action: "append", text: "Tail." } },
      {
        callId: "selection",
        proposal: { action: "replace_selection", text: "Changed." },
      },
    ]);
  });
  run((ctx) => {
    const v = ctx.get(editorViewCtx);
    v.dispatch(
      v.state.tr.setSelection(TextSelection.create(v.state.doc, 9, 14)),
    );
  });
  act(() => {
    expect(result.current.accept("append")).toBe(true);
  });
  act(() => {
    expect(result.current.accept("selection")).toBe(true);
  });
  const markdown = run((ctx) =>
    ctx.get(serializerCtx)(ctx.get(editorViewCtx).state.doc),
  );
  expect(markdown).toContain("Beta.");
  expect(markdown).not.toContain("Alpha.");
  expect(markdown).toContain("Changed.");
});
it("keeps drafts separate across view switches, and rejects manual-edit conflicts", async () => {
  editor = await createTestEditor("Original.");
  const run: EditorRunner = (fn) => editor!.action(fn);
  const { result } = renderHook(() => useDocumentWorkspace(run, "doc"));
  act(() => {
    result.current.setOpen(true);
    result.current.begin("create", "session");
  });
  act(() =>
    result.current.receive([
      { callId: "a", proposal: { action: "append", text: "## Draft" } },
    ]),
  );
  expect(result.current.preview).toContain("## Draft");
  expect(
    run((ctx) => ctx.get(serializerCtx)(ctx.get(editorViewCtx).state.doc)),
  ).not.toContain("Draft");
  act(() => result.current.setOpen(false));
  act(() => result.current.setOpen(true));
  expect(result.current.draft?.operations).toHaveLength(1);
  act(() =>
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.dispatch(view.state.tr.insertText("Manual ", 1));
    }),
  );
  act(() => {
    expect(result.current.accept()).toBe(false);
  });
  expect(result.current.conflict).toBe(true);
  expect(result.current.draft?.operations).toHaveLength(1);
});

it("streams proposals independently from editor decorations and commits a subset", async () => {
  editor = await createTestEditor("");
  const run: EditorRunner = (fn) => editor!.action(fn);
  const { result } = renderHook(() => useDocumentWorkspace(run, "doc"));
  act(() => {
    result.current.setOpen(true);
    result.current.begin("create", "session");
  });
  act(() => {
    result.current.onEvent({
      type: "toolStart",
      callId: "a",
      name: "propose_edit",
    });
    result.current.onEvent({
      type: "toolArgsDelta",
      callId: "a",
      delta: '{"action":"append","text":"First',
    });
  });
  // Streamed chunks are coalesced before the preview re-renders.
  await act(() => new Promise((r) => setTimeout(r, 120)));
  expect(result.current.preview).toContain("First");
  act(() =>
    result.current.receive([
      { callId: "a", proposal: { action: "append", text: "First." } },
      { callId: "b", proposal: { action: "append", text: "Second." } },
    ]),
  );
  act(() => {
    expect(result.current.accept("a")).toBe(true);
  });
  expect(result.current.draft?.operations.map((o) => o.callId)).toEqual(["b"]);
  expect(result.current.preview).toContain("First.");
  expect(result.current.preview).toContain("Second.");
  act(() => {
    expect(result.current.accept()).toBe(true);
  });
  expect(result.current.draft?.operations).toHaveLength(0);
  expect(
    run((ctx) => ctx.get(serializerCtx)(ctx.get(editorViewCtx).state.doc)),
  ).toContain("Second.");
});
it("invalidates a remaining selection proposal when its captured target was consumed", async () => {
  editor = await createTestEditor("Alpha.\n\nBeta.");
  const run: EditorRunner = (fn) => editor!.action(fn);
  run((ctx) => {
    const v = ctx.get(editorViewCtx);
    v.dispatch(
      v.state.tr.setSelection(TextSelection.create(v.state.doc, 1, 7)),
    );
  });
  const { result } = renderHook(() => useDocumentWorkspace(run, "doc"));
  act(() => {
    result.current.begin("edit", "session");
    result.current.receive(
      ["a", "b"].map((callId) => ({
        callId,
        proposal: { action: "replace_selection", text: "Changed." },
      })),
    );
  });
  act(() => {
    expect(result.current.accept("a")).toBe(true);
  });
  expect(result.current.conflict).toBe(true);
  act(() => {
    expect(result.current.accept("b")).toBe(false);
  });
});
it("takes a rejected change after all, even after the document was edited", async () => {
  editor = await createTestEditor("Original.");
  const run: EditorRunner = (fn) => editor!.action(fn);
  const { result } = renderHook(() => useDocumentWorkspace(run, "doc"));
  const proposal = { action: "append" as const, text: "## Kept after all" };
  act(() => {
    result.current.begin("create", "session");
    result.current.receive([{ callId: "a", proposal }]);
  });
  act(() => result.current.discard("a"));
  expect(result.current.statuses.a).toBe("rejected");
  // Typed into since: the restored change lands on the document as it is.
  act(() =>
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.dispatch(view.state.tr.insertText("Manual ", 1));
    }),
  );
  act(() => {
    expect(result.current.reinstate("a", proposal, "session")).toBe(true);
  });
  expect(result.current.statuses.a).toBe("accepted");
  const markdown = run((ctx) =>
    ctx.get(serializerCtx)(ctx.get(editorViewCtx).state.doc),
  );
  expect(markdown).toContain("Manual Original.");
  expect(markdown).toContain("## Kept after all");
});
it("lists the task's rejected changes until one is taken after all", async () => {
  editor = await createTestEditor("Start.");
  const run: EditorRunner = (fn) => editor!.action(fn);
  const { result } = renderHook(() => useDocumentWorkspace(run, "doc"));
  const a = { action: "append" as const, text: "A." };
  const b = { action: "append" as const, text: "B." };
  act(() => {
    result.current.begin("create", "session");
    result.current.receive([
      { callId: "a", proposal: a },
      { callId: "b", proposal: b },
    ]);
  });
  act(() => result.current.discard());
  expect(result.current.rejected.map((o) => o.callId)).toEqual(["a", "b"]);
  act(() => {
    result.current.reinstate("b", b, "session");
  });
  expect(result.current.rejected.map((o) => o.callId)).toEqual(["a"]);
  // A refused call was never the user's to take back.
  act(() => {
    result.current.begin("create", "session");
    result.current.receive([{ callId: "c", proposal: a }]);
  });
  act(() => result.current.discard("c", false));
  expect(result.current.rejected.map((o) => o.callId)).toEqual(["a"]);
});
it("decides each paragraph of a change on its own, in any order, and keeps them in order", async () => {
  editor = await createTestEditor("Start.");
  const run: EditorRunner = (fn) => editor!.action(fn);
  const { result } = renderHook(() => useDocumentWorkspace(run, "doc"));
  const proposal = {
    action: "append" as const,
    text: "## Head\n\nOne.\n\nTwo.\n\nThree.",
  };
  act(() => {
    result.current.begin("create", "session");
    result.current.receive([{ callId: "a", proposal }]);
  });
  let parts: string[] = [];
  act(() => {
    parts = result.current.explode("a");
  });
  expect(parts).toEqual(["a::0", "a::1", "a::2", "a::3"]);
  expect(result.current.statusOf("a")).toBe("pending");
  const doc = () =>
    run((ctx) => ctx.get(serializerCtx)(ctx.get(editorViewCtx).state.doc));
  // The last paragraph first, then the heading: still heading, then it.
  act(() => {
    expect(result.current.accept("a::3")).toBe(true);
  });
  act(() => {
    expect(result.current.accept("a::0")).toBe(true);
  });
  expect(doc()).toMatch(/## Head\s+Three\./);
  // One not taken - and taken back: it lands between its neighbours.
  act(() => result.current.discard("a::1"));
  expect(result.current.rejected.map((o) => o.callId)).toEqual(["a::1"]);
  act(() => {
    expect(result.current.undoReject("a::1", proposal, "session")).toBe(true);
  });
  act(() => {
    expect(result.current.accept("a::1")).toBe(true);
  });
  act(() => result.current.discard("a::2"));
  expect(doc()).toMatch(/## Head\s+One\.\s+Three\./);
  expect(doc()).not.toContain("Two.");
  // Some of it went in: the chat card reads accepted.
  expect(result.current.statusOf("a")).toBe("accepted");
});
it("decides the changes that have arrived while another is still being written", async () => {
  editor = await createTestEditor("Start.");
  const run: EditorRunner = (fn) => editor!.action(fn);
  const { result } = renderHook(() => useDocumentWorkspace(run, "doc"));
  act(() => {
    result.current.begin("create", "session");
    // One whole change, then one whose arguments are still streaming.
    result.current.receive([
      { callId: "done", proposal: { action: "append", text: "Done." } },
    ]);
    result.current.onEvent({
      type: "toolStart",
      callId: "live",
      name: "propose_edit",
    } as never);
    result.current.onEvent({
      type: "toolArgsDelta",
      callId: "live",
      delta: '{"action":"append","text":"Half writ',
    } as never);
  });
  expect(result.current.isSettled("done")).toBe(true);
  expect(result.current.isSettled("live")).toBe(false);
  // 全部采纳 takes what has arrived and leaves the rest in the draft.
  act(() => {
    expect(result.current.accept()).toBe(true);
  });
  const doc = run((ctx) =>
    ctx.get(serializerCtx)(ctx.get(editorViewCtx).state.doc),
  );
  expect(doc).toContain("Done.");
  expect(doc).not.toContain("Half");
});
it("never splits a rewrite into paragraphs", async () => {
  editor = await createTestEditor("Same.\n\nOld ending.");
  const run: EditorRunner = (fn) => editor!.action(fn);
  const { result } = renderHook(() => useDocumentWorkspace(run, "doc"));
  act(() => {
    result.current.begin("edit", "session");
    result.current.receive([
      {
        callId: "r",
        proposal: {
          action: "replace",
          anchor: "Same.\n\nOld ending.",
          text: "Same.\n\nNew ending.",
        },
      },
    ]);
  });
  let parts: string[] = [];
  act(() => {
    parts = result.current.explode("r");
  });
  // Taken a paragraph at a time it would put one paragraph in place of
  // the whole passage: it stays one change.
  expect(parts).toEqual(["r"]);
  expect(result.current.draft?.operations.map((o) => o.callId)).toEqual(["r"]);
});
it("does not split an insertion next to a sentence, and a change that no longer fits fails alone", async () => {
  editor = await createTestEditor(
    "He sat down. He opened the chopsticks.\n\nEnd.",
  );
  const run: EditorRunner = (fn) => editor!.action(fn);
  const { result } = renderHook(() => useDocumentWorkspace(run, "doc"));
  act(() => {
    result.current.begin("edit", "session");
    result.current.receive([
      {
        callId: "inline",
        proposal: {
          action: "insert_after",
          anchor: "He opened the chopsticks.",
          text: "The soup steamed.\n\nHe ate slowly.",
        },
      },
      {
        callId: "gone",
        proposal: {
          action: "insert_after",
          anchor: "Nowhere in the text.",
          text: "Lost.",
        },
      },
    ]);
  });
  // Lands inside its paragraph: taken apart, its "paragraphs" ran together.
  let parts: string[] = [];
  act(() => {
    parts = result.current.explode("inline");
  });
  expect(parts).toEqual(["inline"]);
  // The one that no longer fits fails by itself - no conflict locking the
  // rest, which still goes in.
  act(() => {
    expect(result.current.accept("gone")).toBe(false);
  });
  expect(result.current.conflict).toBe(false);
  expect(result.current.statusOf("gone")).toBe("invalid");
  act(() => {
    expect(result.current.accept()).toBe(true);
  });
  expect(
    run((ctx) => ctx.get(serializerCtx)(ctx.get(editorViewCtx).state.doc)),
  ).toContain("The soup steamed.");
});
it("never writes a split change twice when its final copy arrives after", async () => {
  editor = await createTestEditor("");
  const run: EditorRunner = (fn) => editor!.action(fn);
  const { result } = renderHook(() => useDocumentWorkspace(run, "doc"));
  const proposal = {
    action: "append" as const,
    text: "# Last train\n\nEleven forty.\n\nThe street was empty.",
  };
  act(() => {
    result.current.begin("create", "session");
    result.current.receive([{ callId: "a", proposal }]);
  });
  act(() => {
    result.current.explode("a");
  });
  // The exchange's own final copy of the same call, after the split.
  act(() => {
    result.current.receive([{ callId: "a", proposal }]);
  });
  expect(result.current.draft?.operations.map((o) => o.callId)).toEqual([
    "a::0",
    "a::1",
    "a::2",
  ]);
  act(() => {
    expect(result.current.accept()).toBe(true);
  });
  const doc =
    run((ctx) => ctx.get(serializerCtx)(ctx.get(editorViewCtx).state.doc)) ??
    "";
  expect(doc.match(/Eleven forty\./g)).toHaveLength(1);
  expect(doc.match(/# Last train/g)).toHaveLength(1);
  expect(doc.indexOf("Eleven")).toBeLessThan(doc.indexOf("street"));
});

it("never puts an accepted change back when its final copy arrives after", async () => {
  editor = await createTestEditor("");
  const run: EditorRunner = (fn) => editor!.action(fn);
  const { result } = renderHook(() => useDocumentWorkspace(run, "doc"));
  const proposal = { action: "append" as const, text: "## Two\n\nThe drawer." };
  act(() => {
    result.current.begin("create", "session");
    result.current.receive([{ callId: "s2", proposal }]);
  });
  // Taken while the Agent is still finishing its turn...
  act(() => {
    expect(result.current.accept()).toBe(true);
  });
  // ...whose final copy of the same call then arrives.
  act(() => {
    result.current.receive([{ callId: "s2", proposal }]);
  });
  expect(result.current.draft?.operations ?? []).toHaveLength(0);
  expect(result.current.statusOf("s2")).toBe("accepted");
});
