// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { drawnBlocksToImages } from "./diagram-images";
import {
  markDrawnPictures,
  pictureUrl,
  placeDrawnPictures,
  setDrawnBlocks,
} from "./drawn-blocks";

afterEach(() => setDrawnBlocks(null));

describe("pictureUrl", () => {
  it("takes an image data: URL as it is and makes one of SVG markup", () => {
    expect(pictureUrl("data:image/png;base64,AAAA")).toBe(
      "data:image/png;base64,AAAA",
    );
    expect(pictureUrl(' <svg width="1"></svg>')).toBe(
      "data:image/svg+xml;charset=utf-8," +
        encodeURIComponent('<svg width="1"></svg>'),
    );
  });

  it("is null for anything else", () => {
    expect(pictureUrl(null)).toBeNull();
    expect(pictureUrl("<div></div>")).toBeNull();
    expect(pictureUrl("javascript:alert(1)")).toBeNull();
    expect(pictureUrl("data:text/html,<svg>")).toBeNull();
  });
});

describe("drawn blocks in an export's copy", () => {
  // Two drawings after their hidden sources; only the first has a picture.
  const editor = () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<pre class="hidden">a</pre><div class="drawn" data-language="x"><iframe></iframe></div>' +
      '<pre class="hidden">b</pre><div class="drawn" data-language="x"><iframe></iframe></div>';
    return root;
  };
  const use = () =>
    setDrawnBlocks({
      selector: ".drawn",
      hiddenSource: "hidden",
      language: (el) => el.dataset.language ?? "",
      picture: async (el) =>
        el.previousElementSibling?.textContent === "a" ? "<svg></svg>" : null,
    });

  it("puts each picture in its drawing's place and shows the source of one without", async () => {
    use();
    const live = editor();
    const unmark = await markDrawnPictures(live, "light");
    const copy = live.cloneNode(true) as HTMLElement;
    unmark();
    placeDrawnPictures(copy);
    expect(copy.querySelectorAll("iframe")).toHaveLength(0);
    const img = copy.querySelector("img.drawn-block-picture");
    expect(img?.previousElementSibling?.className).toBe("hidden");
    expect(copy.querySelectorAll("pre")[1].className).toBe("");
    // The live editor is as it was.
    expect(live.querySelectorAll("[data-export-picture]")).toHaveLength(0);
  });
});

describe("drawnBlocksToImages", () => {
  it("keeps the source of a block with no picture, and other languages", async () => {
    const md = "```x\na\n```\n\n```js\n1\n```";
    expect(await drawnBlocksToImages(md, new Map([["x", [null]]]))).toBe(md);
  });
});
