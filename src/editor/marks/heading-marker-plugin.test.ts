// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { closeViews, openView } from "../editor-view-kit";
import { redrawMisplaced } from "./heading-marker-plugin";

afterEach(closeViews);

it("draws a heading again when an IME left its text in front of the #", async () => {
  const t = await openView("## x\n");
  t.caretAt("x", 1);
  const heading = t.view.dom.querySelector("h2")!;
  const marker = heading.querySelector(".heading-marker")!;
  // What WebKit's commit can leave, before ProseMirror reads the change:
  // the text node in front of the marker.
  const text = [...heading.childNodes].find((n) => n.nodeType === 3)!;
  heading.insertBefore(text, marker);
  redrawMisplaced(t.view);
  const now = t.view.dom.querySelector("h2")!;
  expect(now.firstChild).toBe(now.querySelector(".heading-marker"));
  expect(t.markdown()).toBe("## x");
});
