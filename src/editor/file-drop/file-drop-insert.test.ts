// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { closeViews, openView } from "../editor-view-kit";
import { showPulled } from "../blocks/block-handles-plugin";
import { dropEditors, fillRooms } from "./file-drop-insert";

afterEach(closeViews);

describe("files dropped between blocks", () => {
  it("go in where their room stands, moved by edits meanwhile, in one undo step", async () => {
    const v = await openView("first\n\nsecond\n");
    expect(dropEditors.has(v.view)).toBe(true);
    // Room open between the two paragraphs.
    const between = v.view.state.doc.child(0).nodeSize;
    showPulled(v.view, {
      pos: null,
      landing: between,
      room: document.createElement("div"),
    });
    let copied: () => void = () => {};
    const filled = fillRooms(
      v.view,
      () =>
        new Promise((resolve) => {
          copied = () => resolve(["![](boat.png)", "[report.pdf](report.pdf)"]);
        }),
    );
    // Typed at the start while the files were copied.
    v.select(1);
    v.type("the ");
    copied();
    await filled;
    expect(v.markdown()).toBe(
      "the first\n\n![](boat.png)\n\n[report.pdf](report.pdf)\n\nsecond",
    );
    v.press("Mod+z");
    expect(v.markdown()).toBe("the first\n\nsecond");
  });

  it("keep a picture's path as written", async () => {
    const v = await openView("first\n");
    showPulled(v.view, {
      pos: null,
      landing: v.view.state.doc.content.size,
      room: document.createElement("div"),
    });
    await fillRooms(v.view, async () => ["![](assets/boat%201.png)"]);
    expect(v.markdown()).toBe("first\n\n![](assets/boat%201.png)");
  });

  it("put nothing in when nothing came of them", async () => {
    const v = await openView("first\n");
    showPulled(v.view, {
      pos: null,
      landing: v.view.state.doc.content.size,
      room: document.createElement("div"),
    });
    await fillRooms(v.view, async () => []);
    expect(v.markdown()).toBe("first");
  });
});
