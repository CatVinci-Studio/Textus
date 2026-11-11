import { beforeEach, describe, expect, it, vi } from "vitest";
import { version as APP_VERSION } from "../../../package.json";

const installed = new Map<string, string>();
const ipc = {
  catalog: vi.fn(),
  cachedCatalog: vi.fn(() => Promise.resolve(null)),
  skillCatalog: vi.fn(() => Promise.resolve([])),
  installFromCatalog: vi.fn(() => Promise.resolve()),
};
vi.mock("../../platform/ipc", () => ({ plugins: ipc }));
vi.mock("../manager", () => ({
  loadPlugins: vi.fn(() => Promise.resolve()),
  runsHere: () => true,
  pluginName: (r: { id: string }) => r.id,
  pluginText: (_r: unknown, text: string) => text,
  pluginRecord: (id: string) =>
    installed.has(id)
      ? { id, status: "on", manifest: { version: installed.get(id) } }
      : undefined,
}));
vi.mock("../plugin-switches", () => ({
  setPluginEnabled: vi.fn(() => Promise.resolve()),
}));

const {
  installFromCatalog,
  loadCatalog,
  neededTextus,
  offeredItems,
  searchCatalog,
  sortCatalog,
  updateFor,
} = await import("./catalog");

const [major, minor] = APP_VERSION.split(".").map(Number);
const NEWER = `${major}.${minor + 1}.0`;

const entry = (id: string, version: string, engine: string) => ({
  id,
  version,
  official: true,
  size: 1,
  screenshots: [],
  readme: {},
  manifest: {
    id,
    name: id,
    version,
    publisher: "catvinci",
    engines: { textus: engine },
  },
});

describe("catalog versions this Textus can run", () => {
  beforeEach(async () => {
    installed.clear();
    installed.set("catvinci.old", "0.1.0");
    installed.set("catvinci.ok", "0.1.0");
    ipc.installFromCatalog.mockClear();
    ipc.catalog.mockResolvedValue([
      entry("catvinci.old", "0.2.0", `>=${NEWER}`),
      entry("catvinci.ok", "0.2.0", `>=${APP_VERSION}`),
      entry("catvinci.new", "1.0.0", `>=${NEWER}`),
    ]);
    await loadCatalog(true);
  });

  it("offers an update only when the new version runs here", () => {
    expect(updateFor("catvinci.ok")).toBe("0.2.0");
    expect(updateFor("catvinci.old")).toBeNull();
  });

  it("names the Textus a plugin needs, and refuses to install it", async () => {
    await expect(installFromCatalog("catvinci.new")).rejects.toThrow(NEWER);
    expect(ipc.installFromCatalog).not.toHaveBeenCalled();
    await installFromCatalog("catvinci.ok");
    expect(ipc.installFromCatalog).toHaveBeenCalledWith("catvinci.ok");
  });

  it("needs nothing newer for a plugin that runs here", () => {
    expect(
      neededTextus({
        manifest: { engine: `>=${APP_VERSION}` },
      } as Parameters<typeof neededTextus>[0]),
    ).toBeNull();
  });
});

describe("the catalog list", () => {
  const item = (
    id: string,
    description: string,
    installs?: number,
    updated?: string,
  ) =>
    ({
      id,
      installs,
      updated,
      manifest: { name: id, description, author: "CatVinci Studio" },
    }) as unknown as Parameters<typeof searchCatalog>[0][number];
  const list = [
    item("catvinci.kanban", "Boards of cards", 50, "2026-11-01"),
    item("catvinci.graph", "A graph view of your notes", 90, "2026-10-01"),
    item("catvinci.abc", "Music notation", 10, "2026-11-05"),
  ];
  const ids = (l: typeof list) => l.map((i) => i.id);

  it("finds a plugin when every word is in its name, description or maker", () => {
    expect(ids(searchCatalog(list, "kanban"))).toEqual(["catvinci.kanban"]);
    expect(ids(searchCatalog(list, "catvinci graph view"))).toEqual([
      "catvinci.graph",
    ]);
    expect(searchCatalog(list, "CatVinci Studio")).toHaveLength(3);
    expect(searchCatalog(list, "no such plugin")).toHaveLength(0);
  });

  it("sorts the most installed first, the latest first, or by name", () => {
    expect(ids(sortCatalog(list, "popular"))).toEqual([
      "catvinci.graph",
      "catvinci.kanban",
      "catvinci.abc",
    ]);
    expect(ids(sortCatalog(list, "newest"))[0]).toBe("catvinci.abc");
    expect(ids(sortCatalog(list, "name"))).toEqual([
      "catvinci.abc",
      "catvinci.graph",
      "catvinci.kanban",
    ]);
  });
});

describe("the market's list", () => {
  it("leaves out what is installed and what is unlisted, still updated where installed", () => {
    const of = (id: string, unlisted?: boolean) =>
      ({ id, unlisted }) as Parameters<typeof offeredItems>[0][number];
    const items = [of("a"), of("pages", true), of("b")];
    expect(offeredItems(items, new Set(["b"])).map((i) => i.id)).toEqual(["a"]);
  });
});
