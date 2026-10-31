import { describe, expect, it } from "vitest";
import { pathIndex, resolveIn } from "./metadata-cache";

const paths = pathIndex([
  "/v/Notes/Ann.md",
  "/v/People/Ann.md",
  "/v/Deep/Way/Down/Bo.md",
  "/v/Bo.markdown",
  "/v/Docs/guide.md",
]);

describe("resolveIn", () => {
  it("finds a wiki link by name, its own folder's first, else the shortest", () => {
    expect(resolveIn(paths, "Ann", "/v/People/x.md", true)).toBe(
      "/v/People/Ann.md",
    );
    expect(resolveIn(paths, "ann", "/v/Other/x.md", true)).toBe(
      "/v/Notes/Ann.md",
    );
    expect(resolveIn(paths, "Bo#Part|alias", "/v/Other/x.md", true)).toBe(
      "/v/Bo.markdown",
    );
    expect(resolveIn(paths, "Nobody", "/v/x.md", true)).toBeNull();
  });

  it("reads anything else as a path from the linking document's folder", () => {
    expect(resolveIn(paths, "../Docs/guide.md", "/v/Notes/x.md", false)).toBe(
      "/v/Docs/guide.md",
    );
    expect(resolveIn(paths, "Docs/guide", "/v/x.md", false)).toBe(
      "/v/Docs/guide.md",
    );
    expect(
      resolveIn(paths, "https://example.com", "/v/x.md", false),
    ).toBeNull();
  });

  it("indexes ten thousand paths for lookups that don't walk them", () => {
    const many = Array.from(
      { length: 10_000 },
      (_, i) => `/v/n${i % 40}/Note ${i}.md`,
    );
    const index = pathIndex(many);
    const start = performance.now();
    for (let i = 0; i < 20_000; i++)
      resolveIn(index, `Note ${i % 10_000}`, "/v/n1/x.md", true);
    expect(performance.now() - start).toBeLessThan(500);
  });
});
