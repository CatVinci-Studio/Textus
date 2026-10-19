import { describe, expect, it, vi } from "vitest";
import {
  imageStemForMode,
  readImagePresentation,
  resolveImageSrc,
  safeImageStem,
  writeImageWidth,
} from "./image-plugin";

// Tauri's own convertFileSrc percent-encodes the whole path the same way.
vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
  convertFileSrc: (path: string) =>
    `asset://localhost/${encodeURIComponent(path)}`,
}));

/** The file path an asset: URL from resolveImageSrc points at. */
function pathOf(url: string): string {
  return decodeURIComponent(url.replace("asset://localhost/", ""));
}

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
    });
    expect(writeImageWidth("Shot {levis-width=40%}", 60)).toBe(
      "Shot {textus-width=60%}",
    );
  });

  it("can restore automatic sizing and remove metadata-only titles", () => {
    expect(writeImageWidth("{textus-width=50%}", null)).toBe("");
    expect(writeImageWidth("Product shot {textus-width=50%}", null)).toBe(
      "Product shot",
    );
  });
});

describe("local image paths (#135)", () => {
  it("decodes percent-escapes a relative path was written with", () => {
    expect(
      pathOf(resolveImageSrc("my%20pic.png", "/Users/a/notes/doc.md")),
    ).toBe("/Users/a/notes/my pic.png");
    expect(
      pathOf(
        resolveImageSrc(
          "%E5%9B%BE%E7%89%87/%E5%B0%81%E9%9D%A2.png",
          "/Users/a/notes/doc.md",
        ),
      ),
    ).toBe("/Users/a/notes/图片/封面.png");
  });

  it("takes paths written without escapes as they are", () => {
    expect(
      pathOf(resolveImageSrc("图片 1/封 面.png", "/home/a/笔记/doc.md")),
    ).toBe("/home/a/笔记/图片 1/封 面.png");
    expect(
      pathOf(resolveImageSrc("../assets/a b.png", "/home/a/n/doc.md")),
    ).toBe("/home/a/n/../assets/a b.png");
  });

  it("keeps a path whose % is not an escape instead of throwing", () => {
    expect(pathOf(resolveImageSrc("100%.png", "/home/a/doc.md"))).toBe(
      "/home/a/100%.png",
    );
    expect(pathOf(resolveImageSrc("50%25%zz.png", "/home/a/doc.md"))).toBe(
      "/home/a/50%25%zz.png",
    );
  });

  it("resolves against a Windows document's folder", () => {
    const doc = "C:\\Users\\a\\My Notes\\doc.md";
    expect(pathOf(resolveImageSrc("img%20one.png", doc))).toBe(
      "C:\\Users\\a\\My Notes/img one.png",
    );
    expect(pathOf(resolveImageSrc("..\\图片\\a%20b.png", doc))).toBe(
      "C:\\Users\\a\\My Notes/..\\图片\\a b.png",
    );
    expect(pathOf(resolveImageSrc("C:\\pics\\my%20pic.png", null))).toBe(
      "C:\\pics\\my pic.png",
    );
    expect(pathOf(resolveImageSrc("D:/pics/%E5%9B%BE.png", doc))).toBe(
      "D:/pics/图.png",
    );
  });

  it("decodes an absolute path too", () => {
    expect(pathOf(resolveImageSrc("/tmp/a%20b.png", null))).toBe(
      "/tmp/a b.png",
    );
  });

  it("leaves URLs alone, escapes included", () => {
    const url = "https://example.com/a%20b.png";
    expect(resolveImageSrc(url, "/home/a/doc.md")).toBe(url);
    expect(resolveImageSrc("data:image/png;base64,AA==", null)).toBe(
      "data:image/png;base64,AA==",
    );
  });

  it("leaves a relative path unresolved in an unsaved document", () => {
    expect(resolveImageSrc("assets/my%20pic.png", null)).toBe(
      "assets/my%20pic.png",
    );
    expect(resolveImageSrc("../a.png", null)).toBe("../a.png");
  });
});
