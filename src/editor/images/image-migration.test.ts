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
