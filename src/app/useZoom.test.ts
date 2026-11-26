// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { caretAgain } from "./useZoom";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

/** A tab with an editor holding the selection, and a field beside it. */
function tab() {
  document.body.innerHTML =
    '<div id="tab"><div id="editor" contenteditable="true">text</div><input id="find"></div>';
  const editor = document.getElementById("editor")!;
  document.getSelection()!.collapse(editor.firstChild, 2);
  return document.getElementById("tab")!;
}

describe("caretAgain", () => {
  it("sets the editor's selection again, so a phone places its caret anew", () => {
    const el = tab();
    document.getElementById("editor")!.focus();
    const set = vi.spyOn(document.getSelection()!, "setBaseAndExtent");
    caretAgain(el);
    expect(set).toHaveBeenCalledOnce();
  });

  it("leaves the selection alone while a field has the focus", () => {
    const el = tab();
    document.getElementById("find")!.focus();
    const set = vi.spyOn(document.getSelection()!, "setBaseAndExtent");
    caretAgain(el);
    expect(set).not.toHaveBeenCalled();
  });
});
