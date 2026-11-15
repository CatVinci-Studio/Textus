// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { closeViews, openView } from "./editor-view-kit";
import { contextMenuTarget } from "./editor-menu";
import { caretLink } from "./editor-menu-links";
import type { EditorRunner } from "./useEditorRunner";

afterEach(closeViews);

describe("a link in the editor's menu", () => {
  it("is the caret's when the menu opens from a button (the phone's ⋯)", async () => {
    const t = await openView("See [Note A](Note%20A.md) here\n");
    t.caretAt("Note A", 2);
    const button = document.createElement("button");
    const target = contextMenuTarget(
      (fn) => t.editor.action(fn),
      { target: button },
      "/notes/B.md",
    );
    expect(target.link).toMatchObject({ docPath: "/notes/B.md" });
    expect(target.link?.href).toContain("Note");
  });

  it("reaches the phone's ⋯ sheet from the caret alone", async () => {
    const t = await openView("See [Note A](Note%20A.md) here\n");
    t.caretAt("Note A", 2);
    const run: EditorRunner = (fn) => t.editor.action(fn);
    expect(caretLink(run, "/n/B.md")?.href).toContain("Note");
    t.caretAt("here", 1);
    expect(caretLink(run, "/n/B.md")).toBeNull();
  });

  it("is a note link's too, opened and copied by its source", async () => {
    const t = await openView("See [[Note A]] here\n");
    t.caretAt("Note A", 2);
    const run: EditorRunner = (fn) => t.editor.action(fn);
    expect(caretLink(run, "/n/B.md")).toMatchObject({
      source: "[[Note A]]",
      wiki: true,
    });
  });
});
