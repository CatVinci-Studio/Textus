import { expect, it, vi } from "vitest";
const migrate = vi.hoisted(() =>
  vi.fn(async () => [{ old: "assets/image.png", new: "assets/image.png" }]),
);
vi.mock("../../platform/ipc", () => ({ fs: { migrateDraftImages: migrate } }));
import { migrateDraftImages } from "./image-migration";
it("copies relative assets from the previous document on cross-directory Save As", async () => {
  const content = "![Diagram](assets/image.png)\n";
  const result = await migrateDraftImages(
    "/B/article.md",
    content,
    "/A/article.md",
  );
  expect(migrate).toHaveBeenCalledWith(
    "/B/article.md",
    ["assets/image.png"],
    "/A/article.md",
  );
  expect(result.content).toBe(content);
  expect(result.mappings).toEqual([
    { old: "assets/image.png", new: "assets/image.png" },
  ]);
});
it("passes the decoded path of a percent-encoded generated image and rewrites the original", async () => {
  const encoded =
    "/Users/me/Library/Application%20Support/com.catvinci.textus/assets/image-1.jpg";
  const decoded = decodeURI(encoded);
  migrate.mockResolvedValueOnce([{ old: decoded, new: "assets/image-1.jpg" }]);
  const result = await migrateDraftImages(
    "/B/article.md",
    `![Art](${encoded})\n`,
  );
  expect(migrate).toHaveBeenLastCalledWith("/B/article.md", [decoded], null);
  expect(result.content).toBe("![Art](assets/image-1.jpg)\n");
  expect(result.mappings).toEqual([
    { old: encoded, new: "assets/image-1.jpg" },
  ]);
});
