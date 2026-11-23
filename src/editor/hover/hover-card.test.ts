// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

/** Each preview's way to finish drawing: its body as tall as `height`. */
const finish: Array<(height: number) => void> = [];
vi.mock("../preview-editor", () => ({
  drawPreview: (root: HTMLElement) =>
    new Promise((resolve) =>
      finish.push((height) => {
        root.dataset.height = String(height);
        resolve({ destroy() {}, update() {} });
      }),
    ),
}));
const { showHoverCard, hideHoverCard } = await import("./hover-card");

const HEAD = 30;
// A card is as tall as its head and the body drawn so far.
HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
  const body = this.querySelector<HTMLElement>(".hover-card-body");
  const height = this.classList.contains("hover-card")
    ? HEAD + Number(body?.dataset.height ?? 0)
    : 0;
  return new DOMRect(0, 0, 300, height);
};

afterEach(() => {
  hideHoverCard(true);
  finish.length = 0;
  vi.useRealTimers();
});

const card = () => document.querySelector<HTMLElement>(".hover-card")!;
// A link near the window's bottom: the card opens above it.
const link = () => new DOMRect(100, window.innerHeight - 40, 50, 16);

describe("a link's hover card", () => {
  it("opens once its preview is drawn, placed by its whole height", async () => {
    vi.useFakeTimers();
    showHoverCard("k", link(), { title: "Note", markdown: "Text" });
    await vi.advanceTimersByTimeAsync(20);
    // Placed by its head alone, a card above the link grew down over it.
    expect(card().classList).not.toContain("hover-card-open");
    finish[0]!(200);
    await vi.advanceTimersByTimeAsync(20);
    expect(card().classList).toContain("hover-card-open");
    const bottom = parseFloat(card().style.top) + HEAD + 200;
    expect(bottom).toBeLessThanOrEqual(link().top);
  });

  it("opens anyway when the preview is slow, and is placed again when it lands", async () => {
    vi.useFakeTimers();
    showHoverCard("k", link(), { title: "Note", markdown: "Text" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(card().classList).toContain("hover-card-open");
    finish[0]!(200);
    await vi.advanceTimersByTimeAsync(20);
    expect(parseFloat(card().style.top) + HEAD + 200).toBeLessThanOrEqual(
      link().top,
    );
  });

  it("leaves a card that was replaced meanwhile alone", async () => {
    vi.useFakeTimers();
    showHoverCard("a", link(), { title: "A", markdown: "A" });
    const first = card();
    showHoverCard("b", link(), { title: "B", markdown: "B" });
    finish[0]!(200);
    await vi.advanceTimersByTimeAsync(1000);
    expect(first.isConnected).toBe(false);
    expect(first.classList).not.toContain("hover-card-open");
  });
});
