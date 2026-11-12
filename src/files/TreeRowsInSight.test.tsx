// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TreeRowsInSight } from "./TreeRowsInSight";
import type { DirEntryInfo } from "../platform/bindings/files";

let seen: ((hit: boolean) => void) | null = null;
class FakeObserver {
  constructor(private callback: IntersectionObserverCallback) {}
  observe() {
    seen = (hit) =>
      this.callback(
        [{ isIntersecting: hit } as IntersectionObserverEntry],
        this as unknown as IntersectionObserver,
      );
  }
  disconnect() {}
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const entries = Array.from(
  { length: 500 },
  (_, i) => ({ name: `f${i}.md`, path: `/v/f${i}.md` }) as DirEntryInfo,
);

it("draws a big folder's rows as they come near, and always the open one", () => {
  vi.stubGlobal("IntersectionObserver", FakeObserver);
  const at = (needed: string | null) => (
    <TreeRowsInSight
      entries={entries}
      needed={(e) => e.path === needed}
      row={(e) => <div key={e.path} className="row" />}
    />
  );
  const { container, rerender } = render(at(null));
  const rows = () => container.querySelectorAll(".row").length;
  expect(rows()).toBe(200);
  expect(container.querySelector(".tree-rows-more")).not.toBeNull();
  rerender(at("/v/f349.md"));
  expect(rows()).toBe(350);
  act(() => seen!(true));
  expect(rows()).toBe(500);
  expect(container.querySelector(".tree-rows-more")).toBeNull();
});
