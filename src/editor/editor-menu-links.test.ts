// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { closeViews, openView } from "./editor-view-kit";
import { contextMenuTarget } from "./editor-menu";

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
});
