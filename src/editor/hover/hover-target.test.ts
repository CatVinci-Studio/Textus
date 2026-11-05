// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { EditorView } from "@milkdown/kit/prose/view";

vi.mock("../../ui/zoomed-rects", () => ({ zoomedRectScale: () => 1.5 }));
const { hoverSpot } = await import("./hover-target");

describe("hoverSpot", () => {
  it("is where the link is drawn when the engine reports it unzoomed", () => {
    const dom = document.createElement("div");
    dom.innerHTML = '<p><a href="https://x.org">x</a></p>';
    document.body.append(dom);
    const link = dom.querySelector("a")!;
    link.getBoundingClientRect = () => new DOMRect(100, 40, 20, 10);
    const view = { dom } as unknown as EditorView;
    const event = { target: link } as unknown as MouseEvent;
    const { rect } = hoverSpot(view, event, null)!;
    expect([rect.left, rect.top, rect.width, rect.height]).toEqual([
      150, 60, 30, 15,
    ]);
  });
});
