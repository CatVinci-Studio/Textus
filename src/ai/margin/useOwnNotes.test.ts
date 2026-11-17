// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { editorViewCtx } from "@milkdown/kit/core";
import type { Editor } from "@milkdown/kit/core";

const file = vi.hoisted(() => ({
  text: null as string | null,
  writes: [] as string[],
}));
vi.mock("../../platform/ipc", () => ({
  ownNotes: {
    read: async () => file.text,
    write: async (_path: string, _kind: string, text: string) => {
      file.writes.push(text);
      file.text = text;
    },
  },
}));

import { createTestEditor } from "../../document-view/editor-test-harness";
import type { EditorRunner } from "../../editor/useEditorRunner";
import { resolveStrings } from "../../i18n/strings";
import { reviewNotesKey, type ReviewNote } from "./review-notes-plugin";
import { useOwnNotes } from "./useOwnNotes";

let editor: Editor;
beforeEach(async () => {
  file.text = null;
  file.writes = [];
  editor = await createTestEditor("Alpha beta gamma.\n\nSecond line here.\n");
});
afterEach(() => {
  cleanup();
  editor.destroy();
});

const run = ((f: (ctx: never) => unknown) =>
  editor.action(f as never)) as unknown as EditorRunner;
const notesNow = () =>
  editor.action(
    (ctx) => reviewNotesKey.getState(ctx.get(editorViewCtx).state)!.notes,
  );
const stored = (id: string, anchor: string) => ({
  id,
  comment: `on ${anchor}`,
  anchor,
  before: "",
});
const mount = (notes: ReviewNote[]) =>
  renderHook(
    (props: { notes: ReviewNote[] }) =>
      useOwnNotes({
        run,
        filePath: "/a.md",
        notes: props.notes,
        t: resolveStrings("en"),
      }),
    { initialProps: { notes } },
  );
const settle = () =>
  act(async () => void (await new Promise((r) => setTimeout(r, 0))));

it("keeps in the file a note whose passage isn't in the text now", async () => {
  file.text = JSON.stringify([
    stored("here", "beta"),
    stored("gone", "no such words"),
  ]);
  const hook = mount([]);
  await settle();
  expect(notesNow().map((n) => n.id)).toEqual(["here"]);
  // The notes change (as the plugin reports them): what is written still
  // holds the one that could not be placed.
  hook.rerender({ notes: notesNow() });
  await act(async () => void (await new Promise((r) => setTimeout(r, 450))));
  const last = JSON.parse(file.writes.at(-1) ?? file.text!) as { id: string }[];
  expect(last.map((n) => n.id).sort()).toEqual(["gone", "here"]);
});

it("writes a note made a moment before the editor goes", async () => {
  const hook = mount([]);
  await settle();
  const note: ReviewNote = {
    id: "new",
    from: 7,
    to: 11,
    comment: "?",
    num: 1,
    by: "me",
  };
  hook.rerender({ notes: [note] });
  hook.unmount();
  expect(file.writes).toHaveLength(1);
  expect(JSON.parse(file.writes[0])[0]).toMatchObject({
    id: "new",
    anchor: "beta",
  });
});

it("takes a plugin's note while open, signed and kept with the writer's, and lets one go", async () => {
  const { openNotes } = await import("./notes-by-path");
  file.text = JSON.stringify([
    stored("here", "beta"),
    stored("gone", "no such words"),
  ]);
  const hook = mount([]);
  await settle();
  const held = openNotes("/a.md")!;
  expect(held.ready()).toBe(true);
  expect(held.add({ anchor: "absent", comment: "x", author: "Review" })).toBe(
    null,
  );
  const id = held.add({ anchor: "Second", comment: "Hm", author: "Review" })!;
  expect(notesNow().find((n) => n.id === id)?.author).toBe("Review");
  expect(held.remove("gone")).toBe(true);
  expect(held.remove("nothing")).toBe(false);
  hook.rerender({ notes: notesNow() });
  await act(async () => void (await new Promise((r) => setTimeout(r, 450))));
  const last = JSON.parse(file.writes.at(-1)!) as {
    id: string;
    author?: string;
  }[];
  expect(last.map((n) => [n.id, n.author])).toEqual([
    ["here", undefined],
    [id, "Review"],
  ]);
  expect(held.list().map((n) => n.id)).toEqual(["here", id]);
  hook.unmount();
  expect(openNotes("/a.md")).toBeNull();
});
