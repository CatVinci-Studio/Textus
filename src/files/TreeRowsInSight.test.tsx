// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TreeRowsInSight } from "./TreeRowsInSight";
import { DRAW_ALL_ROWS } from "../engine/controls/useTreeKeys";
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
      dir="/v"
      entries={entries}
      needed={(e) => e.path === needed}
      row={(e) => <div key={e.path} className="row" tabIndex={-1} />}
    />
  );
  const { container, rerender } = render(at(null));
  const rows = () => container.querySelectorAll(".row").length;
  expect(rows()).toBe(200);
  expect(container.querySelector(".tree-rows-more")).not.toBeNull();
  // A drop on the blank rows lands in this folder.
  expect(
    container.querySelector<HTMLElement>(".tree-rows-more")!.dataset.dropDir,
  ).toBe("/v");
  rerender(at("/v/f349.md"));
  expect(rows()).toBe(350);
  // Rows once drawn stay when another document opens.
  rerender(at(null));
  expect(rows()).toBe(350);
  act(() => seen!(true));
  expect(rows()).toBe(500);
  expect(container.querySelector(".tree-rows-more")).toBeNull();
});

it("draws more as the keyboard nears the end, and all at End", () => {
  vi.stubGlobal("IntersectionObserver", FakeObserver);
  const { container } = render(
    <div>
      <TreeRowsInSight
        dir="/v"
        entries={entries}
        needed={() => false}
        row={(e) => <div key={e.path} className="row" tabIndex={-1} />}
      />
    </div>,
  );
  const rows = () => container.querySelectorAll<HTMLElement>(".row");
  act(() => rows()[150].focus());
  expect(rows().length).toBe(200);
  act(() => rows()[197].focus());
  expect(rows().length).toBe(400);
  act(() => {
    container
      .querySelector(".tree-rows-more")!
      .dispatchEvent(new Event(DRAW_ALL_ROWS));
  });
  expect(rows().length).toBe(500);
});

it("End reaches a big folder's last row, through the tree's own keys", async () => {
  vi.stubGlobal("IntersectionObserver", FakeObserver);
  // jsdom lays nothing out: every row counts as shown.
  vi.spyOn(Element.prototype, "getClientRects").mockReturnValue([
    {},
  ] as unknown as DOMRectList);
  const { useTreeKeys } = await import("../engine/controls/useTreeKeys");
  function Tree() {
    const { ref, onKeyDown } = useTreeKeys<HTMLDivElement>();
    return (
      <div ref={ref} role="tree" onKeyDown={onKeyDown}>
        <TreeRowsInSight
          dir="/v"
          entries={entries}
          needed={() => false}
          row={(e) => (
            <div key={e.path} role="treeitem" tabIndex={-1} data-path={e.path}>
              {e.name}
            </div>
          )}
        />
      </div>
    );
  }
  const { container } = render(<Tree />);
  const first = container.querySelector<HTMLElement>('[role="treeitem"]')!;
  act(() => first.focus());
  act(() => {
    first.dispatchEvent(
      new KeyboardEvent("keydown", { key: "End", bubbles: true }),
    );
  });
  expect((document.activeElement as HTMLElement).dataset.path).toBe(
    "/v/f499.md",
  );
});
