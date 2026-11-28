// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

// The sidebar is placed by the rail's token, never by reading its own
// place: read just after its edge's drag writes the grid, a place lays the
// whole window out there and then.
const set = vi.hoisted(() => vi.fn());
vi.mock("../../engine/frame/clock", () => ({ frameClock: { set } }));
vi.mock("../../engine/tokens/token-px", () => ({ tokenPx: () => 48 }));

import { placeSidebar } from "./useSidebarFrame";

afterEach(() => {
  set.mockClear();
  document.body.replaceChildren();
});

function shell(rail: boolean) {
  const app = document.createElement("div");
  app.className = "app-shell";
  if (rail) {
    const r = document.createElement("nav");
    r.className = "activity-rail";
    app.append(r);
  }
  const aside = document.createElement("aside");
  aside.className = "sidebar";
  app.append(aside);
  document.body.append(app);
  Object.defineProperty(aside, "offsetLeft", {
    get: () => {
      throw new Error("read the sidebar's place");
    },
  });
  return aside;
}

const reveal = () => set.mock.calls[0]![1].get("sidebar").rect.w;

describe("placing the sidebar", () => {
  it("reveals it past the rail by its width, without reading its place", () => {
    placeSidebar(shell(true), 264);
    expect(reveal()).toBe(48 + 264);
  });

  it("reveals it by its width alone with no rail", () => {
    placeSidebar(shell(false), 264);
    expect(reveal()).toBe(264);
  });
});
