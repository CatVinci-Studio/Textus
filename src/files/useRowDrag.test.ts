// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TreeSelection } from "./tree-selection";
import { useRowDrag } from "./useRowDrag";
import { LEAVE_AFTER_MS, rowsOut } from "./drag-out";

const ipc = vi.hoisted(() => ({
  out: null as null | ((took: boolean) => void),
  dragOut: vi.fn(),
  transfer: vi.fn(async () => true),
}));
vi.mock("../platform/ipc", async (real) => {
  const actual = await real<typeof import("../platform/ipc")>();
  return {
    ...actual,
    fs: {
      ...actual.fs,
      dragOut: (paths: string[]) => {
        ipc.dragOut(paths);
        return new Promise<boolean>((took) => (ipc.out = took));
      },
    },
  };
});
vi.mock("../platform/capabilities", async (real) => ({
  ...(await real<typeof import("../platform/capabilities")>()),
  canDragFilesOut: true,
}));

const pointer = (type: string, x: number, y: number) =>
  window.dispatchEvent(
    Object.assign(
      new MouseEvent(type, { clientX: x, clientY: y, buttons: 1 }),
      { pointerId: 1 },
    ),
  );

const dragFrom = (
  path: string,
  pointerType: string,
  selection: TreeSelection,
) => {
  const tree = document.createElement("div");
  document.body.append(tree);
  const { result } = renderHook(() =>
    useRowDrag({ current: tree }, selection, vi.fn(), ipc.transfer),
  );
  const down = { button: 0, clientX: 20, clientY: 20, target: tree };
  act(() =>
    result.current.onRowPointerDown(
      { ...down, pointerType, nativeEvent: down } as never,
      path,
      "a.md",
      false,
    ),
  );
  return result;
};

afterEach(() => {
  ipc.out?.(false);
  ipc.out = null;
  ipc.dragOut.mockClear();
  document.body.replaceChildren();
});

it("hands the picked rows to the system's drag once the mouse leaves the window", async () => {
  const selection = new TreeSelection();
  const rows = [
    { path: "/proj/notes", isDir: true },
    { path: "/proj/notes/a.md", isDir: false },
    { path: "/proj/b.md", isDir: false },
  ];
  selection.pick("toggle", "/proj/b.md", rows, null);
  selection.pick("toggle", "/proj/notes", rows, null);
  selection.pick("toggle", "/proj/notes/a.md", rows, null);
  const result = dragFrom("/proj/b.md", "mouse", selection);
  act(() => pointer("pointermove", 60, 20));
  expect(result.current.drag).not.toBeNull();
  expect(ipc.dragOut).not.toHaveBeenCalled();

  // An overshoot past the edge, come back: still the tree's drag.
  act(() => pointer("pointermove", -5, 20));
  act(() => pointer("pointermove", 60, 20));
  expect(ipc.dragOut).not.toHaveBeenCalled();
  expect(result.current.drag).not.toBeNull();

  // Past the edge a moment, as a push at the edge to scroll overshoots.
  vi.useFakeTimers();
  act(() => pointer("pointermove", -100, 20));
  act(() => vi.advanceTimersByTime(LEAVE_AFTER_MS - 50));
  act(() => pointer("pointermove", 60, 20));
  act(() => vi.advanceTimersByTime(LEAVE_AFTER_MS));
  expect(ipc.dragOut).not.toHaveBeenCalled();

  act(() => pointer("pointermove", -100, 20));
  act(() => vi.advanceTimersByTime(LEAVE_AFTER_MS));
  vi.useRealTimers();
  // The folder carries what is inside it; the drag in the page is over.
  expect(ipc.dragOut).toHaveBeenCalledWith(["/proj/b.md", "/proj/notes"]);
  expect(result.current.drag).toBeNull();
  expect(rowsOut()).not.toBeNull();
  // The release the system's drag takes moves nothing.
  act(() => pointer("pointerup", -100, 20));
  expect(ipc.transfer).not.toHaveBeenCalled();

  await act(async () => ipc.out?.(true));
  expect(rowsOut()).toBeNull();
});

it("keeps a pen's drag in the window, where it can drop", () => {
  dragFrom("/proj/b.md", "pen", new TreeSelection());
  act(() => pointer("pointermove", -100, 20));
  expect(ipc.dragOut).not.toHaveBeenCalled();
});

it("lets go of a drag out whose end never came at the next press", () => {
  dragFrom("/proj/b.md", "mouse", new TreeSelection());
  vi.useFakeTimers();
  act(() => pointer("pointermove", -100, 20));
  act(() => vi.advanceTimersByTime(LEAVE_AFTER_MS));
  vi.useRealTimers();
  expect(rowsOut()).not.toBeNull();
  act(() => pointer("pointerdown", 20, 20));
  expect(rowsOut()).toBeNull();
});
