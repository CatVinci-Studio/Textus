import { beforeEach, describe, expect, it, vi } from "vitest";

const disk = new Set<string>();
let root: string | null = null;
vi.mock("../../platform/ipc", () => ({
  fs: {
    documentLinkRoot: () => Promise.resolve(root),
    fileMtimeMs: (path: string) => Promise.resolve(disk.has(path) ? 1 : null),
  },
}));
vi.mock("../../platform/window-folder", () => ({ windowFolder: () => null }));

const { rootedImagePath } = await import("./rooted-image");

describe("rootedImagePath", () => {
  beforeEach(() => {
    disk.clear();
    root = null;
  });

  it("reads a / image from the document's link root, as Typora does", async () => {
    root = "/v/Typora/../附件";
    disk.add("/v/Typora/../附件/红色方块.png");
    expect(
      await rootedImagePath(
        "/%E7%BA%A2%E8%89%B2%E6%96%B9%E5%9D%97.png",
        "/v/Typora/a.md",
      ),
    ).toBe("/v/Typora/../附件/红色方块.png");
  });

  it("keeps a full disk path that only the disk holds", async () => {
    root = "/v";
    disk.add("/Users/me/a.png");
    expect(await rootedImagePath("/Users/me/a.png", "/v/b.md")).toBe(
      "/Users/me/a.png",
    );
  });

  it("is the disk path with no root, and the root's when neither has it", async () => {
    expect(await rootedImagePath("/x.png", "/d/a.md")).toBe("/x.png");
    root = "/r";
    expect(await rootedImagePath("/y.png", "/d/c.md")).toBe("/r/y.png");
  });
});
