// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { back, onBack } from "./back";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("Android's Back", () => {
  it("closes an open layer as Escape does, before anything else", () => {
    const sheet = document.createElement("div");
    sheet.className = "sheet";
    sheet.getClientRects = () => [{}] as unknown as DOMRectList;
    document.body.append(sheet);
    const escape = vi.fn();
    window.addEventListener("keydown", (e) => e.key === "Escape" && escape());
    const sidebar = vi.fn(() => true);
    const off = onBack(sidebar);
    expect(back()).toBe(true);
    expect(escape).toHaveBeenCalled();
    expect(sidebar).not.toHaveBeenCalled();
    off();
  });

  it("then the newest closer that closes something, else nothing", () => {
    const older = vi.fn(() => true);
    const newer = vi.fn(() => false);
    const offOlder = onBack(older);
    const offNewer = onBack(newer);
    expect(back()).toBe(true);
    expect(newer).toHaveBeenCalled();
    expect(older).toHaveBeenCalled();
    offOlder();
    offNewer();
    expect(back()).toBe(false);
  });

  it("counts the find bar as a layer: its own Escape closes it", () => {
    const bar = document.createElement("div");
    bar.className = "find-replace-bar";
    bar.getClientRects = () => [{}] as unknown as DOMRectList;
    document.body.append(bar);
    const escape = vi.fn();
    window.addEventListener("keydown", (e) => e.key === "Escape" && escape());
    const step = vi.fn(() => true);
    const off = onBack(step);
    expect(back()).toBe(true);
    expect(escape).toHaveBeenCalled();
    expect(step).not.toHaveBeenCalled();
    off();
  });
});
