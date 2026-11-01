import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TITLE_EXCERPT_CHARS,
  TITLE_TIMEOUT_MS,
  aiMarkdownFilename,
  titleExcerpt,
  wantsAiTitle,
} from "./doc-title";

const BODY = "Some thoughts about the garden this spring.\n\nMore text.";

describe("wantsAiTitle", () => {
  it("leaves a document with a level-one heading to its heading", () => {
    expect(wantsAiTitle("# Garden\n\nText")).toBe(false);
  });

  it("names a document with text but no level-one heading", () => {
    expect(wantsAiTitle("## Part\n\nText")).toBe(true);
  });

  it("doesn't name an empty document", () => {
    expect(wantsAiTitle("\n\n   \n")).toBe(false);
  });
});

describe("titleExcerpt", () => {
  it("sends only the start of a long document", () => {
    const excerpt = titleExcerpt(`${"a".repeat(TITLE_EXCERPT_CHARS)}END`);
    expect(excerpt).toHaveLength(TITLE_EXCERPT_CHARS);
    expect(excerpt).not.toContain("END");
  });

  it("never ends on half of an emoji", () => {
    const excerpt = titleExcerpt(`${"a".repeat(TITLE_EXCERPT_CHARS - 1)}😀`);
    expect(excerpt).toBe("a".repeat(TITLE_EXCERPT_CHARS - 1));
  });
});

describe("aiMarkdownFilename", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses the AI's title as a cleaned file name", async () => {
    const suggest = vi.fn().mockResolvedValue("Spring: the garden?");
    await expect(
      aiMarkdownFilename(BODY, "Some thoughts.md", "Untitled", suggest),
    ).resolves.toBe("Spring- the garden-.md");
    expect(suggest).toHaveBeenCalledWith(BODY);
  });

  it("doesn't ask when the document has a level-one heading", async () => {
    const suggest = vi.fn();
    await expect(
      aiMarkdownFilename("# Garden\n\nText", "Garden.md", "Untitled", suggest),
    ).resolves.toBe("Garden.md");
    expect(suggest).not.toHaveBeenCalled();
  });

  it("falls back to the first line when the AI fails or has no title", async () => {
    const failing = vi.fn().mockRejectedValue(new Error("textus-ai-off"));
    await expect(
      aiMarkdownFilename(BODY, "First.md", "Untitled", failing),
    ).resolves.toBe("First.md");
    const empty = vi.fn().mockResolvedValue(null);
    await expect(
      aiMarkdownFilename(BODY, "First.md", "Untitled", empty),
    ).resolves.toBe("First.md");
  });

  it("falls back to the first line when the AI is too slow", async () => {
    vi.useFakeTimers();
    const slow = vi.fn(() => new Promise<string | null>(() => {}));
    const name = aiMarkdownFilename(BODY, "First.md", "Untitled", slow);
    await vi.advanceTimersByTimeAsync(TITLE_TIMEOUT_MS);
    await expect(name).resolves.toBe("First.md");
  });
});
