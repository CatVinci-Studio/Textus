import { beforeEach, describe, expect, it, vi } from "vitest";
import { fs } from "../../platform/ipc";
import { migrateDraftImages } from "./image-migration";

vi.mock("../../platform/ipc", () => ({
  fs: { migrateDraftImages: vi.fn() },
}));

const migrate = vi.mocked(fs.migrateDraftImages);

beforeEach(() => {
  migrate.mockReset();
});

describe("migrateDraftImages", () => {
  it("offers a saved document's relative images when it is saved elsewhere", async () => {
    migrate.mockResolvedValue([{ old: "pics/p.png", new: "assets/p.png" }]);
    const result = await migrateDraftImages(
      "/B/b.md",
      "![Plan](pics/p.png)\n\nSee pics/p.png and ![](https://x.org/a.png)\n",
      "assets",
      "/A/a.md",
    );
    expect(migrate).toHaveBeenCalledWith(
      "/B/b.md",
      ["pics/p.png"],
      "assets",
      "/A/a.md",
    );
    // Only the image's own link changes, not the same words in the text.
    expect(result.content).toBe(
      "![Plan](assets/p.png)\n\nSee pics/p.png and ![](https://x.org/a.png)\n",
    );
    expect(result.migrated).toBe(true);
  });

  it("offers no relative image on a draft's first save", async () => {
    const result = await migrateDraftImages(
      "/B/b.md",
      "![](pics/p.png)\n",
      "assets",
      null,
    );
    expect(migrate).not.toHaveBeenCalled();
    expect(result.migrated).toBe(false);
  });

  it("finds a draft image whose path has a space, written in angle brackets", async () => {
    const pasted =
      "/Users/me/Library/Application Support/com.catvinci.textus/assets/image-1.png";
    migrate.mockResolvedValue([{ old: pasted, new: "assets/image-1.png" }]);
    const result = await migrateDraftImages(
      "/B/b.md",
      `![](<${pasted}>)\n`,
      "assets",
      null,
    );
    expect(migrate).toHaveBeenCalledWith("/B/b.md", [pasted], "assets", null);
    expect(result.content).toBe("![](<assets/image-1.png>)\n");
  });

  it("reads a percent-encoded name as the file's and writes a new one encoded", async () => {
    migrate.mockResolvedValue([
      { old: "my pic (1).png", new: "assets/my pic (1).png" },
    ]);
    const result = await migrateDraftImages(
      "/B/b.md",
      "![](my%20pic%20%281%29.png)\n",
      "assets",
      "/A/a.md",
    );
    expect(migrate.mock.calls[0][1]).toEqual(["my pic (1).png"]);
    expect(result.content).toBe("![](assets/my%20pic%20%281%29.png)\n");
  });

  it("lists an image that failed to copy and leaves its link as it was", async () => {
    migrate.mockResolvedValue([{ old: "pics/p.png", new: null }]);
    const result = await migrateDraftImages(
      "/B/b.md",
      "![](pics/p.png)\n",
      "assets",
      "/A/a.md",
    );
    expect(result).toEqual({
      content: "![](pics/p.png)\n",
      migrated: false,
      failed: ["pics/p.png"],
    });
  });
});
