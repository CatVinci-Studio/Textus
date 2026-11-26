// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useTreeKeys } from "./useTreeKeys";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Tree({ rows, selected }: { rows: string[]; selected?: string }) {
  const { ref, onKeyDown } = useTreeKeys<HTMLDivElement>();
  return (
    <div ref={ref} role="tree" onKeyDown={onKeyDown}>
      {rows.map((name) => (
        <div
          key={name}
          role="treeitem"
          aria-selected={name === selected}
          data-name={name}
        >
          {name}
        </div>
      ))}
    </div>
  );
}

it("keeps one row in the tab order as rows come and go, each row reachable", async () => {
  // jsdom lays nothing out: every row counts as shown.
  vi.spyOn(Element.prototype, "getClientRects").mockReturnValue([
    {},
  ] as unknown as DOMRectList);
  const { container, rerender } = render(<Tree rows={["a", "b"]} />);
  const stops = () =>
    [...container.querySelectorAll('[tabindex="0"]')].map(
      (el) => (el as HTMLElement).dataset.name,
    );
  const unreachable = () =>
    container.querySelectorAll('[role="treeitem"]:not([tabindex])').length;
  expect(stops()).toEqual(["a"]);
  rerender(<Tree rows={["a", "b", "c", "d"]} selected="c" />);
  await act(async () => {});
  // Nothing focused yet: the selected row leads.
  expect(stops()).toEqual(["c"]);
  expect(unreachable()).toBe(0);
  act(() =>
    (container.querySelector('[data-name="b"]') as HTMLElement).focus(),
  );
  expect(stops()).toEqual(["b"]);
  // The focused row goes: the selected one takes the stop.
  rerender(<Tree rows={["a", "c", "d"]} selected="c" />);
  await act(async () => {});
  expect(stops()).toEqual(["c"]);
  expect(unreachable()).toBe(0);
});

it("typing goes to the next row whose name starts with it, a letter again to the one after", () => {
  vi.spyOn(Element.prototype, "getClientRects").mockReturnValue([
    {},
  ] as unknown as DOMRectList);
  const { container } = render(
    <Tree rows={["apple", "banana", "blue", "cherry", "Bold"]} />,
  );
  const row = (name: string) =>
    container.querySelector(`[data-name="${name}"]`) as HTMLElement;
  const focused = () => (document.activeElement as HTMLElement).dataset.name;
  const type = (key: string) =>
    fireEvent.keyDown(document.activeElement!, { key });
  act(() => row("apple").focus());
  type("b");
  expect(focused()).toBe("banana");
  type("b");
  expect(focused()).toBe("blue");
  type("b");
  // Case left aside.
  expect(focused()).toBe("Bold");
  type("b");
  expect(focused()).toBe("banana");
  // After a pause a name starts again; typed on, it goes on from the row
  // it is at.
  const now = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(now + 2000);
  type("b");
  expect(focused()).toBe("blue");
  type("o");
  expect(focused()).toBe("Bold");
  type("x");
  expect(focused()).toBe("Bold");
});
