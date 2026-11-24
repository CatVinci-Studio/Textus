// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { watchSystemDrags } from "./finder-drag";
import { dragOut } from "../../files/drag-out";

const heard = vi.hoisted(() => new Map<string, (e: unknown) => void>());
vi.mock("../../platform/events", async (real) => ({
  ...(await real<typeof import("../../platform/events")>()),
  listenToThisWebview: (event: string, handler: (e: unknown) => void) => {
    heard.set(event, handler);
    return Promise.resolve(() => {});
  },
}));
const out = vi.hoisted(() => ({ end: (() => {}) as (took: boolean) => void }));
vi.mock("../../platform/ipc", async (real) => {
  const actual = await real<typeof import("../../platform/ipc")>();
  return {
    ...actual,
    fs: {
      ...actual.fs,
      dragOut: () => new Promise<boolean>((end) => (out.end = end)),
    },
    windowIpc: { ...actual.windowIpc, dragModifiers: async () => null },
  };
});

it("hears the tree's own rows, brought back from outside, as no file manager's, though the drag ends first", async () => {
  const drop = vi.fn();
  // Asked of the disk, the answer comes once the drag out has ended.
  let answer = () => {};
  const isFolder = () =>
    new Promise<boolean>((done) => (answer = () => done(false)));
  watchSystemDrags({ over: vi.fn(), leave: vi.fn(), drop }, isFolder);
  const event = (name: string, paths: string[]) =>
    heard.get(`tauri://${name}`)!({
      payload: { paths, position: { x: 1, y: 1 } },
    });
  const fromSystem = async () => {
    await vi.waitFor(() => expect(drop).toHaveBeenCalled());
    const files = drop.mock.calls[0]![0] as { fromSystem: boolean }[];
    drop.mockClear();
    return files.map((f) => f.fromSystem);
  };

  const going = dragOut(["/proj/a.md"]);
  event("drag-enter", ["/proj/a.md"]);
  event("drag-drop", ["/proj/a.md"]);
  out.end(true);
  await going;
  answer();
  expect(await fromSystem()).toEqual([false]);

  event("drag-enter", ["/proj/a.md"]);
  event("drag-drop", ["/proj/a.md"]);
  answer();
  expect(await fromSystem()).toEqual([true]);
});
