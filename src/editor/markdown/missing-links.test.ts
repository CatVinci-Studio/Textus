// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { editorViewCtx, type Editor } from "@milkdown/kit/core";
import { createTestEditor } from "../editor-test-kit";
import { fs } from "../../platform/ipc";

const editors: Editor[] = [];
const dimmed = (root: HTMLElement) =>
  [...root.querySelectorAll(".wikilink")]
    .filter((link) => link.querySelector(".wikilink-missing"))
    .map((link) => link.textContent);
afterEach(async () => {
  await Promise.all(editors.splice(0).map((editor) => editor.destroy()));
  vi.restoreAllMocks();
});

it("dims only the links to missing notes, and sends nothing when that stays the same", async () => {
  const asked = vi
    .spyOn(fs, "resolveNoteLink")
    .mockImplementation(async (_doc, note) => ({
      path: `/v/${note}.md`,
      exists: note !== "Gone",
    }));
  const editor = await createTestEditor(
    "See [[Here]] and [[Gone]].\n\nend\n",
    {},
    "/v/a.md",
  );
  editors.push(editor);
  const view = editor.action((ctx) => ctx.get(editorViewCtx));
  await vi.waitFor(() => expect(dimmed(view.dom)).toEqual(["[[Gone]]"]));
  const sent = vi.spyOn(view, "dispatch");
  view.dispatch(view.state.tr.insertText("x", view.state.doc.content.size - 2));
  await new Promise((r) => setTimeout(r, 400));
  // The typing only: the same link stays dimmed, nothing more is sent,
  // and the names already asked aren't asked again.
  expect(sent).toHaveBeenCalledTimes(1);
  expect(asked).toHaveBeenCalledTimes(2);
  expect(dimmed(view.dom)).toEqual(["[[Gone]]"]);
});
