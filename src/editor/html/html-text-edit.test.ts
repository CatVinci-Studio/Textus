// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { closeViews, openView } from "../editor-view-kit";
import { rewrite, sourceSegments } from "./html-text-edit";

describe("editing an HTML block's words", () => {
  const source =
    '<table>\n  <tr><th width="50%">Q &amp; A</th></tr>\n  <!-- note -->\n  <tr><td><img src="a.png"> caption</td></tr>\n</table>';

  it("finds each run of words between tags, decoded, and not comments", () => {
    expect(sourceSegments(source).map((s) => s.text)).toEqual([
      "Q & A",
      "caption",
    ]);
  });

  it("writes new words between the same tags, escaped", () => {
    const segments = sourceSegments(source);
    expect(rewrite(source, segments, ["Q & A", "a <new> caption"])).toBe(
      source.replace(" caption<", " a &lt;new&gt; caption<"),
    );
    expect(rewrite(source, segments, ["Q & A", "caption"])).toBeNull();
  });
});

describe("editing one cell of an HTML table in place", () => {
  afterEach(closeViews);

  const table =
    "<table><tr><td>Old poems</td><td>Clerk <ruby>墨羽<rt>mò yǔ</rt></ruby> list</td></tr></table>\n\nAfter.";

  async function editFirstCell(key: "Enter" | "Escape") {
    // jsdom has no layout, which ProseMirror's own mouse handling reads.
    if (!("elementFromPoint" in document))
      Object.assign(document, { elementFromPoint: () => null });
    // Nor isContentEditable, which the box's keys check.
    if (!("isContentEditable" in HTMLElement.prototype))
      Object.defineProperty(HTMLElement.prototype, "isContentEditable", {
        get(this: HTMLElement) {
          return !!this.closest('[contenteditable="true"]');
        },
      });
    const t = await openView(table);
    t.caretAtEnd();
    const cell = t.view.dom.querySelector(".raw-html-rendered td")!;
    cell.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );
    (cell.firstChild as Text).data += ", quills";
    t.view.dom
      .querySelector(".raw-html-edit-box")!
      .dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    return t;
  }

  it("writes that cell's words and leaves a ruby's reading in another cell as it was", async () => {
    const t = await editFirstCell("Enter");
    expect(t.markdown()).toBe(table.replace("Old poems", "Old poems, quills"));
  });

  it("puts the words back on Escape, the ruby's reading still drawn", async () => {
    const t = await editFirstCell("Escape");
    expect(t.markdown()).toBe(table);
    expect(t.view.dom.querySelector(".raw-html-rendered rt")?.textContent).toBe(
      "mò yǔ",
    );
  });
});
