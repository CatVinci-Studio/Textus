import { describe, expect, it } from "vitest";
import { fileBadge, forgetFileBadges, setFileBadge } from "./file-badges";

describe("a file's badge from plugins", () => {
  it("shows one per file, the plugin last by id winning, and goes with it", () => {
    setFileBadge("b.two", "/n/a.md", { text: "draft", tone: "warning" });
    setFileBadge("a.one", "/n/a.md", { text: "3" });
    expect(fileBadge("/n/a.md")).toEqual({
      text: "draft",
      tone: "warning",
      tooltip: null,
    });
    forgetFileBadges("b.two");
    expect(fileBadge("/n/a.md")?.text).toBe("3");
    setFileBadge("a.one", "/n/a.md", null);
    expect(fileBadge("/n/a.md")).toBeNull();
  });

  it("refuses a long badge or an unknown tone", () => {
    expect(() =>
      setFileBadge("a.one", "/n/b.md", { text: "far too long a badge" }),
    ).toThrow();
    expect(() =>
      setFileBadge("a.one", "/n/b.md", { text: "x", tone: "pink" }),
    ).toThrow();
    expect(fileBadge("/n/b.md")).toBeNull();
  });
});
