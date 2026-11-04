// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import {
  closeViews,
  openView,
  type TestView,
} from "../document-view/editor-view-kit";

// A drag selection begun on bold text or a heading selected nothing: the
// caret arriving drew the span's `**` or the heading's `#` under the
// pointer, and the web view started the drag over. While the mouse button
// is held, they wait.

afterEach(closeViews);

const marks = (t: TestView) =>
  [...t.view.dom.querySelectorAll(".enclosure-delimiter, .heading-marker")].map(
    (el) => el.textContent,
  );

/** The button pressed on the text, as a drag selection begins. */
function press(t: TestView) {
  // jsdom has no layout, which ProseMirror's own mouse handling reads.
  if (!("elementFromPoint" in document))
    Object.assign(document, { elementFromPoint: () => null });
  t.view.dom
    .querySelector("p")!
    .dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );
}

const release = (event: Event = new MouseEvent("mouseup")) =>
  window.dispatchEvent(event);

it("a span's ** and a heading's # wait while the mouse button is held", async () => {
  const t = await openView("# Title\n\nSome **bold** words.");
  t.caretAtEnd();
  press(t);
  // Where a drag takes the selection: from the bold word up into the heading.
  t.select(t.caretAt("bold", 2), t.caretAt("Title", 2));
  expect(marks(t)).toEqual([]);
  release();
  expect(marks(t)).toEqual(["# ", "**", "**"]);
});

it("the marks follow the caret at once again after the button is let go", async () => {
  const t = await openView("Some **bold** words.");
  t.caretAt("bold", 2);
  expect(marks(t)).toEqual(["**", "**"]);
  press(t);
  release();
  t.caretAtEnd();
  expect(marks(t)).toEqual([]);
});

it("a move with the button up lets go of a press whose mouseup was never seen", async () => {
  const t = await openView("Some **bold** words.");
  t.caretAtEnd();
  press(t);
  t.caretAt("bold", 2);
  // Still held while it moves: a drag.
  release(new MouseEvent("mousemove", { buttons: 1 }));
  expect(marks(t)).toEqual([]);
  release(new MouseEvent("mousemove", { buttons: 0 }));
  expect(marks(t)).toEqual(["**", "**"]);
});

it("a key typed lets go of such a press, but not Shift held through a drag", async () => {
  const t = await openView("Some **bold** words.");
  t.caretAtEnd();
  press(t);
  t.caretAt("bold", 2);
  release(new KeyboardEvent("keydown", { key: "Shift" }));
  expect(marks(t)).toEqual([]);
  release(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
  expect(marks(t)).toEqual(["**", "**"]);
});
