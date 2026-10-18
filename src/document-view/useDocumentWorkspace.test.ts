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
