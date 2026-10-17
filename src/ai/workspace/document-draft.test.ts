// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { editorViewCtx, serializerCtx } from "@milkdown/kit/core";
import { undo } from "@milkdown/kit/prose/history";
import type { Editor } from "@milkdown/kit/core";
import { createTestEditor } from "../../document-view/editor-test-harness";
import {
  buildDraftTransaction,
  captureDraft,
  previewDraft,
} from "./document-draft";
import { documentRevisionKey } from "./revision-plugin";

let editor: Editor | undefined;
afterEach(async () => {
  await editor?.destroy();
  editor = undefined;
});

describe("document draft transactions", () => {
  it("appends sections in order, previews without mutation, and commits in one undo step", async () => {
    editor = await createTestEditor("# Original\n");
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const original = view.state.doc;
      const draft = captureDraft(ctx, view.state, "document", "session");
      draft.operations = [
        {
          callId: "a",
          proposal: { action: "append", text: "## First\n\nOne." },
        },
        {
          callId: "b",
          proposal: { action: "append", text: "## Second\n\nTwo." },
        },
      ];
      const preview = previewDraft(ctx, view.state, draft);
      expect(preview).toContain("## First");
      expect(preview.indexOf("First")).toBeLessThan(preview.indexOf("Second"));
      expect(view.state.doc.eq(original)).toBe(true);
      const tr = buildDraftTransaction(ctx, view.state, draft);
      expect(tr).not.toBeNull();
      view.dispatch(tr!);
      expect(ctx.get(serializerCtx)(view.state.doc)).toContain("Two.");
      expect(undo(view.state, view.dispatch)).toBe(true);
      expect(view.state.doc.eq(original)).toBe(true);
    });
  });

  it("rejects a stale revision even after undo restores identical text", async () => {
    editor = await createTestEditor("Start.");
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const draft = captureDraft(ctx, view.state, "document", "session");
      draft.operations.push({
        callId: "a",
        proposal: { action: "append", text: "New." },
      });
      view.dispatch(view.state.tr.insertText("x", 1));
      undo(view.state, view.dispatch);
      expect(documentRevisionKey.getState(view.state)).toBeGreaterThan(
        draft.baseRevision,
      );
      expect(buildDraftTransaction(ctx, view.state, draft)).toBeNull();
    });
  });

  it("rejects missing, repeated and overlapping targets without partial commits", async () => {
    editor = await createTestEditor("Same. Same.\n\nUnique.");
    editor.action((ctx) => {
      const state = ctx.get(editorViewCtx).state;
      for (const anchor of ["missing", "Same."]) {
        const draft = captureDraft(ctx, state, "doc", "session");
        draft.operations.push({
          callId: "a",
          proposal: { action: "replace", anchor, text: "Changed." },
        });
        expect(buildDraftTransaction(ctx, state, draft)).toBeNull();
      }
      const draft = captureDraft(ctx, state, "doc", "session");
      draft.operations = ["a", "b"].map((callId) => ({
        callId,
        proposal: { action: "replace", anchor: "Unique.", text: "Changed." },
      }));
      expect(buildDraftTransaction(ctx, state, draft)).toBeNull();
      expect(ctx.get(editorViewCtx).state).toBe(state);
    });
  });

  it("creates an empty document and can accept a subset without writing the rest", async () => {
    editor = await createTestEditor("");
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const draft = captureDraft(ctx, view.state, "doc", "session");
      draft.operations = ["First", "Second"].map((text, i) => ({
        callId: String(i),
        proposal: { action: "append", text: `## ${text}` },
      }));
      const tr = buildDraftTransaction(ctx, view.state, {
        ...draft,
        operations: draft.operations.slice(0, 1),
      });
      expect(tr).not.toBeNull();
      view.dispatch(tr!);
      expect(ctx.get(serializerCtx)(view.state.doc)).toContain("First");
      expect(ctx.get(serializerCtx)(view.state.doc)).not.toContain("Second");
    });
  });
});
