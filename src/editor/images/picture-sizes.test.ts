// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

const read = vi.hoisted(() => vi.fn());
vi.mock("../../platform/ipc", () => ({ fs: { pictureSize: read } }));

import { rememberSize, reserveRoom } from "./picture-sizes";

const settle = () => new Promise((r) => setTimeout(r));

describe("a picture's room before it loads", () => {
  it("is what its file says, asked once the view is made", async () => {
    read.mockResolvedValueOnce({ width: 640, height: 480 });
    const img = document.createElement("img");
    reserveRoom(img, "/n/a.md\nx.png", "x.png", "/n/a.md", () => true);
    expect(read).toHaveBeenCalledWith("/n/x.png");
    await settle();
    expect([img.width, img.height]).toEqual([640, 480]);
    // Drawn again, at once.
    const again = document.createElement("img");
    reserveRoom(again, "/n/a.md\nx.png", "x.png", "/n/a.md", () => true);
    expect([again.width, again.height]).toEqual([640, 480]);
  });

  it("is left alone for another picture by then, or a web one", async () => {
    read.mockClear();
    read.mockResolvedValueOnce({ width: 640, height: 480 });
    const img = document.createElement("img");
    reserveRoom(img, "/n/a.md\ny.png", "y.png", "/n/a.md", () => false);
    await settle();
    expect(img.hasAttribute("width")).toBe(false);
    reserveRoom(img, "k", "https://e.com/p.png", "/n/a.md", () => true);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("is the loaded size, remembered for next time", () => {
    const img = document.createElement("img");
    Object.defineProperty(img, "naturalWidth", { value: 30 });
    Object.defineProperty(img, "naturalHeight", { value: 20 });
    rememberSize("/n/a.md\nz.png", img);
    const next = document.createElement("img");
    reserveRoom(next, "/n/a.md\nz.png", "z.png", "/n/a.md", () => true);
    expect([next.width, next.height]).toEqual([30, 20]);
  });

  it("is kept for the latest pictures only, and never for one written in", () => {
    const img = document.createElement("img");
    Object.defineProperty(img, "naturalWidth", { value: 30 });
    Object.defineProperty(img, "naturalHeight", { value: 20 });
    rememberSize("/n/a.md\ndata:image/png;base64,AAAA", img);
    for (let i = 0; i < 600; i++) rememberSize(`/n/a.md\n${i}.png`, img);
    const room = (key: string) => {
      const next = document.createElement("img");
      reserveRoom(next, key, "https://e.com/p.png", "/n/a.md", () => true);
      return next.hasAttribute("width");
    };
    expect(room("/n/a.md\ndata:image/png;base64,AAAA")).toBe(false);
    expect(room("/n/a.md\n0.png")).toBe(false);
    expect(room("/n/a.md\n599.png")).toBe(true);
  });
});
