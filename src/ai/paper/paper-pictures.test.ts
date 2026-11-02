// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { closeViews, openView } from "../../document-view/editor-view-kit";
import { paperPictures, placePicture } from "./paper-pictures";

afterEach(closeViews);

const paper = [
  "Text.",
  "![A green roof](textus-generated:ab12)",
  "*Figure 1. A green roof*",
  "![Lost](textus-generated:cd34)",
  "More.",
].join("\n\n");

describe("a paper's pictures", () => {
  it("are found with the caption that places them", () => {
    expect(paperPictures(paper)).toEqual([
      { id: "ab12", alt: "A green roof", caption: "Figure 1. A green roof" },
    ]);
  });

  it("go above their caption once saved", async () => {
    const t = await openView("Text.\n\n*Figure 1. A green roof*\n\nMore.");
    const [picture] = paperPictures(paper);
    const placed = t.editor.action((ctx) =>
      placePicture(t.view, ctx, picture, "assets/green roof.png"),
    );
    expect(placed).toBe(true);
    expect(t.markdown()).toBe(
      "Text.\n\n![A green roof](<assets/green roof.png>)\n\n*Figure 1. A green roof*\n\nMore.",
    );
  });

  it("are left out when their caption is gone", async () => {
    const t = await openView("Text.");
    const [picture] = paperPictures(paper);
    expect(
      t.editor.action((ctx) => placePicture(t.view, ctx, picture, "a.png")),
    ).toBe(false);
    expect(t.markdown()).toBe("Text.");
  });
});
