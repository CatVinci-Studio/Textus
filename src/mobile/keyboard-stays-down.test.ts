// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { keyboardStaysDown } from "./keyboard-stays-down";

afterEach(() => {
  document.body.innerHTML = "";
});

function editor() {
  const el = document.createElement("div");
  el.className = "ProseMirror";
  el.tabIndex = 0;
  document.body.append(el);
  return el;
}

describe("a document brought to the front on a phone", () => {
  it("lets go of focus its editor takes on its own", () => {
    const el = editor();
    const stop = keyboardStaysDown();
    el.focus();
    expect(document.activeElement).not.toBe(el);
    stop();
  });

  it("keeps it after a tap in the page", () => {
    const el = editor();
    const stop = keyboardStaysDown();
    el.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    el.focus();
    expect(document.activeElement).toBe(el);
    stop();
  });
});
