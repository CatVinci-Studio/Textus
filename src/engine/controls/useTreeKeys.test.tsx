// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
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
  act(() => (container.querySelector('[data-name="b"]') as HTMLElement).focus());
  expect(stops()).toEqual(["b"]);
  // The focused row goes: the selected one takes the stop.
  rerender(<Tree rows={["a", "c", "d"]} selected="c" />);
  await act(async () => {});
  expect(stops()).toEqual(["c"]);
  expect(unreachable()).toBe(0);
});
