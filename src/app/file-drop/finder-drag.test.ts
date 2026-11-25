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
const out = vi.hoisted(() => ({
  end: (() => {}) as (took: boolean) => void,
  keys: null as null | { shift: boolean; alt: boolean; ctrl: boolean },
  mac: false,
}));
vi.mock("../../platform/os", async (real) => ({
  ...(await real<typeof import("../../platform/os")>()),
  isMacPlatform: () => out.mac,
}));
vi.mock("../../platform/ipc", async (real) => {
  const actual = await real<typeof import("../../platform/ipc")>();
  return {
    ...actual,
    fs: {
      ...actual.fs,
      dragOut: () => new Promise<boolean>((end) => (out.end = end)),
    },
    windowIpc: { ...actual.windowIpc, dragModifiers: async () => out.keys },
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

  const going = dragOut([{ path: "/proj/a.md", isDir: false }]);
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

it("takes the rows brought back as they went out, and tells the copy key held: Option on a Mac, Ctrl elsewhere", async () => {
  const drop = vi.fn();
  watchSystemDrags({ over: vi.fn(), leave: vi.fn(), drop }, async () => false);
  const event = (name: string, paths: string[]) =>
    heard.get(`tauri://${name}`)!({
      payload: { paths, position: { x: 1, y: 1 } },
    });
  const dropped = async () => {
    await vi.waitFor(() => expect(drop).toHaveBeenCalled());
    const [files, , held] = drop.mock.calls[0]!;
    drop.mockClear();
    return { files, held };
  };

  const going = dragOut([{ path: "/link/notes", isDir: true }]);
  // The system names the folder by where it really is.
  event("drag-enter", ["/real/notes"]);
  out.keys = { shift: false, alt: false, ctrl: true };
  event("drag-drop", ["/real/notes"]);
  expect(await dropped()).toEqual({
    files: [{ path: "/link/notes", isDir: true, fromSystem: false }],
    held: { shift: false, copy: true },
  });
  out.mac = true;
  event("drag-drop", ["/real/notes"]);
  expect((await dropped()).held).toEqual({ shift: false, copy: false });
  out.keys = { shift: false, alt: true, ctrl: false };
  event("drag-drop", ["/real/notes"]);
  expect((await dropped()).held).toEqual({ shift: false, copy: true });
  // A drag out whose end was never heard: a file manager's next drag, of
  // other files, is its own, never the rows gone out.
  event("drag-enter", ["/downloads/notes.md"]);
  event("drag-drop", ["/downloads/notes.md"]);
  expect((await dropped()).files).toEqual([
    { path: "/downloads/notes.md", isDir: false, fromSystem: true },
  ]);
  out.end(true);
  await going;
});
