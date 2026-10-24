// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { editorViewCtx } from "@milkdown/kit/core";
import type { Editor } from "@milkdown/kit/core";
import { createTestEditor } from "../../document-view/editor-test-harness";
import {
  commentCalls,
  numberNotes,
  reviewNotesKey,
} from "./review-notes-plugin";

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe("review notes", () => {
  it("reads add_comment calls, skipping ones still streaming", () => {
    expect(
      commentCalls([
        { kind: "User", text: "x" } as never,
        {
          kind: "ToolCall",
          name: "add_comment",
          call_id: "a",
          arguments: JSON.stringify({ anchor: "One", comment: "Why?" }),
        },
        {
          kind: "ToolCall",
          name: "add_comment",
          call_id: "b",
          arguments: '{"anchor": "Tw',
        },
        {
          kind: "ToolCall",
          name: "propose_edit",
          call_id: "c",
          arguments: "{}",
        },
      ]),
    ).toEqual([
      { id: "a:0", anchor: "One", comment: "Why?", block: undefined },
    ]);
  });

  it("reads each of a call's comments, by its place in the call", () => {
    expect(
      commentCalls([
        {
          kind: "ToolCall",
          name: "add_comment",
          call_id: "a",
          arguments: JSON.stringify({
            comments: [
              { block: "b1", anchor: "One", comment: "Why?" },
              { block: "b2", anchor: "Two", comment: "How?" },
            ],
          }),
        },
      ]),
    ).toEqual([
      { id: "a:0", anchor: "One", comment: "Why?", block: "b1" },
      { id: "a:1", anchor: "Two", comment: "How?", block: "b2" },
    ]);
  });

  // The badge "2" is the chat's second note card, wherever in the text
  // its passage is - and a later note never renumbers the ones on screen.
  it("are numbered in the order they were left, not by position", () => {
    const first = numberNotes(
      [],
      [
        { id: "late", from: 40, to: 45, comment: "a" },
        { id: "early", from: 1, to: 5, comment: "b" },
      ],
    );
    expect(first.map((n) => [n.id, n.num])).toEqual([
      ["late", 1],
      ["early", 2],
    ]);
    const next = numberNotes(first, [
      { id: "earliest", from: 0, to: 1, comment: "c" },
    ]);
    expect(next.map((n) => [n.id, n.num])).toEqual([
      ["late", 1],
      ["early", 2],
      ["earliest", 3],
    ]);
    expect(
      numberNotes([], [{ id: "x", from: 0, to: 1, comment: "d" }])[0].num,
    ).toBe(1);
  });

  it("stay on their passage through edits and go with it", async () => {
    editor = await createTestEditor("Alpha beta gamma.\n");
    const state = () =>
      editor!.action((ctx) =>
        reviewNotesKey.getState(ctx.get(editorViewCtx).state)!,
      );
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      // "beta" is 7..11 (paragraph opens at 0, text starts at 1).
      view.dispatch(
        view.state.tr.setMeta(reviewNotesKey, {
          type: "set",
          notes: [{ id: "n", from: 7, to: 11, comment: "?", num: 1 }],
        }),
      );
      view.dispatch(view.state.tr.insertText("Oh ", 1));
    });
    const note = state().notes[0];
    expect(
      editor.action((ctx) =>
        ctx.get(editorViewCtx).state.doc.textBetween(note.from, note.to),
      ),
    ).toBe("beta");
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.dispatch(view.state.tr.delete(note.from, note.to));
    });
    expect(state().notes).toEqual([]);
  });
});
