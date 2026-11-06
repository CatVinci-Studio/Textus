// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import {
  closeViews,
  openView,
  type TestView,
} from "../../document-view/editor-view-kit";

// Typora's keys for what Format had none for: Ctrl+` inline code,
// Ctrl+Shift+` strikethrough, Cmd/Ctrl+K a link.

afterEach(closeViews);

/** Ctrl+` by the physical key, as a keyboard sends it. */
function backquote(t: TestView, shift = false) {
  const event = new KeyboardEvent("keydown", {
    key: shift ? "~" : "`",
    code: "Backquote",
    ctrlKey: true,
    shiftKey: shift,
    bubbles: true,
    cancelable: true,
  });
  t.view.dom.dispatchEvent(event);
  return event.defaultPrevented;
}

it("Ctrl+` makes the selection inline code, and again takes it off", async () => {
  const t = await openView("call foo now\n");
  t.caretAt("foo", 0, 3);
  expect(backquote(t)).toBe(true);
  expect(t.markdown()).toBe("call `foo` now");
  t.caretAt("foo", 1);
  expect(backquote(t)).toBe(true);
  expect(t.markdown()).toBe("call foo now");
});

it("Ctrl+` with nothing selected opens code to type in", async () => {
  const t = await openView("call it\n");
  t.caretAt("it");
  backquote(t);
  t.type("x");
  expect(t.markdown()).toBe("call `x`it");
});

it("Ctrl+Shift+` strikes the selection through", async () => {
  const t = await openView("an old word\n");
  t.caretAt("old", 0, 3);
  expect(backquote(t, true)).toBe(true);
  expect(t.markdown()).toBe("an ~~old~~ word");
});

it("Cmd/Ctrl+K puts the selection in a link, the caret where its address goes", async () => {
  const t = await openView("see the docs here\n");
  t.caretAt("the docs", 0, 8);
  expect(t.press("Mod+k")).toBe(true);
  expect(t.caretLine()).toBe("see [the docs](|) here");
  t.type("https://example.com");
  t.caretAtEnd();
  expect(t.markdown()).toBe("see [the docs](https://example.com) here");
  expect(t.view.dom.querySelector("a")?.getAttribute("href")).toBe(
    "https://example.com",
  );
});
