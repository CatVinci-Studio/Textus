// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { currentHeading } from "./outline-current";

/** A tab's editor as tabElement finds it, its headings placed by `tops`. */
function editor(tops: (number | null)[]) {
  document.body.innerHTML = "";
  const pane = document.createElement("div");
  pane.className = "main-pane";
  const tab = document.createElement("div");
  tab.dataset.tabId = "tab-1";
  const scroller = document.createElement("div");
  scroller.className = "editor-scroll";
  const content = document.createElement("div");
  content.className = "editor-content";
  const root = document.createElement("div");
  root.className = "ProseMirror";
  scroller.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
  content.append(root);
  scroller.append(content);
  tab.append(scroller);
  pane.append(tab);
  document.body.append(pane);
  tops.forEach((top, i) => {
    const h = document.createElement("h2");
    h.textContent = `Heading ${i}`;
    // null: folded away, no place on screen.
    h.getClientRects = () =>
      (top === null ? [] : [{}]) as unknown as DOMRectList;
    h.getBoundingClientRect = () => ({ top: top ?? 0 }) as DOMRect;
    root.append(h);
  });
}

describe("the section being read", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("is the last heading above the reading line", () => {
    editor([-200, 10, 300]);
    expect(currentHeading("tab-1")).toBe(1);
  });

  it("is -1 above the first heading", () => {
    editor([200, 300]);
    expect(currentHeading("tab-1")).toBe(-1);
  });

  it("skips a heading folded out of sight", () => {
    editor([-200, null, 10]);
    expect(currentHeading("tab-1")).toBe(2);
  });

  it("is -1 when the tab has no editor", () => {
    document.body.innerHTML = "";

    expect(currentHeading("tab-1")).toBe(-1);
  });
});
