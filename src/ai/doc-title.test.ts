// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TITLE_EXCERPT_CHARS,
  TITLE_IDLE_MS,
  titleExcerpt,
  useDraftTitles,
  wantsAiTitle,
} from "./doc-title";
import { ai } from "../platform/ipc";
import type { DocTab } from "../document/doc-tabs";

vi.mock("../platform/ipc", () => ({ ai: { suggestDocTitle: vi.fn() } }));

const BODY = "Some thoughts about the garden this spring.\n\nMore text.";

describe("wantsAiTitle", () => {
  it("leaves a document with a level-one heading to its heading", () => {
    expect(wantsAiTitle("# Garden\n\nText")).toBe(false);
  });

  it("names a document with text but no level-one heading", () => {
    expect(wantsAiTitle("## Part\n\nSome text about the part")).toBe(true);
  });

  it("doesn't name a few words, which say too little", () => {
    expect(wantsAiTitle("Trip pl")).toBe(false);
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

describe("useDraftTitles", () => {
  const draft: DocTab = {
    id: "a",
    path: null,
    content: BODY,
    savedContent: "",
    diskMtime: null,
    sourceMode: false,
    reloadKey: 0,
  };
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(ai.suggestDocTitle)
      .mockReset()
      .mockResolvedValue("Spring garden");
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  const render = (tabs: DocTab[], provider: string | null = "openai") =>
    renderHook(
      (props: { tabs: DocTab[] }) =>
        useDraftTitles(props.tabs, provider, "mini"),
      { initialProps: { tabs } },
    );

  it("names a draft once typing rests, without being asked", async () => {
    const { result } = render([draft]);
    expect(result.current(draft)).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(TITLE_IDLE_MS));
    expect(ai.suggestDocTitle).toHaveBeenCalledWith({
      provider: "openai",
      model: "mini",
      excerpt: BODY,
    });
    expect(result.current(draft)).toBe("Spring garden");
  });

  it("asks again only when the first line changes", async () => {
    const { rerender } = render([draft]);
    await act(() => vi.advanceTimersByTimeAsync(TITLE_IDLE_MS));
    rerender({ tabs: [{ ...draft, content: `${BODY}\n\nEven more.` }] });
    await act(() => vi.advanceTimersByTimeAsync(TITLE_IDLE_MS));
    expect(ai.suggestDocTitle).toHaveBeenCalledTimes(1);
    rerender({ tabs: [{ ...draft, content: `Autumn instead.\n\n${BODY}` }] });
    await act(() => vi.advanceTimersByTimeAsync(TITLE_IDLE_MS));
    expect(ai.suggestDocTitle).toHaveBeenCalledTimes(2);
  });

  it("asks nothing with AI off, for a heading, or for a document with a file", async () => {
    render([draft], null);
    render([{ ...draft, content: "# Garden\n\nText about the garden" }]);
    render([{ ...draft, path: "/n/a.md" }]);
    await act(() => vi.advanceTimersByTimeAsync(TITLE_IDLE_MS));
    expect(ai.suggestDocTitle).not.toHaveBeenCalled();
  });

  it("keeps the first line when the AI fails", async () => {
    vi.mocked(ai.suggestDocTitle).mockRejectedValue(new Error("textus-ai-off"));
    const { result } = render([draft]);
    await act(() => vi.advanceTimersByTimeAsync(TITLE_IDLE_MS));
    expect(result.current(draft)).toBeNull();
  });
});
