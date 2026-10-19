import { describe, expect, it } from "vitest";
import {
  imageStemForMode,
  readImagePresentation,
  safeImageStem,
  writeImageRotation,
  writeImageWidth,
} from "./image-plugin";

describe("image upload filenames", () => {
  it("keeps a safe original filename without its extension", () => {
    const file = new File(["image"], "Product screenshot.png", {
      type: "image/png",
    });
    expect(imageStemForMode(file, "original")).toBe("Product screenshot");
  });

  it("removes path and platform-reserved filename characters", () => {
    expect(safeImageStem("  launch</>page:*?  .png")).toBe("launch---page---");
  });

  it("falls back when the name has no usable stem", () => {
    expect(safeImageStem("...png")).toBe("image");
  });

  it("creates a collision-resistant automatic name", () => {
    const file = new File(["image"], "image.png", { type: "image/png" });
    expect(imageStemForMode(file, "auto")).toMatch(/^\d{8}-\d{6}-[a-z0-9]{4}$/);
  });
});

describe("image width metadata", () => {
  it("reads a saved width without exposing it as the image tooltip", () => {
    expect(readImagePresentation("Product shot {textus-width=70%}")).toEqual({
      title: "Product shot",
      widthPercent: 70,
      rotate: 0,
    });
  });

  it("updates the width while preserving a regular Markdown title", () => {
    expect(writeImageWidth("Product shot {textus-width=50%}", 70)).toBe(
      "Product shot {textus-width=70%}",
    );
  });

  it("reads a width Levis saved and rewrites it with the textus key", () => {
    expect(readImagePresentation("Shot {levis-width=40%}")).toEqual({
      title: "Shot",
      widthPercent: 40,
      rotate: 0,
    });
    expect(writeImageWidth("Shot {levis-width=40%}", 60)).toBe(
      "Shot {textus-width=60%}",
    );
  });

  it("can restore automatic sizing and remove metadata-only titles", () => {
    expect(writeImageWidth("{textus-width=50%}", null)).toBeNull();
    expect(writeImageWidth("Product shot {textus-width=50%}", null)).toBe(
      "Product shot",
    );
  });

  it("keeps rotation and width together and turns in quarter steps", () => {
    const turned = writeImageRotation("Shot {textus-width=50%}", 1);
    expect(turned).toBe("Shot {textus-width=50% textus-rotate=90}");
    expect(readImagePresentation(turned)).toEqual({
      title: "Shot",
      widthPercent: 50,
      rotate: 90,
    });
    expect(writeImageWidth(turned, 70)).toBe(
      "Shot {textus-width=70% textus-rotate=90}",
    );
    expect(writeImageRotation(null, -1)).toBe("{textus-rotate=270}");
    expect(writeImageRotation("{textus-rotate=270}", 1)).toBeNull();
  });
});
