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
  pluginRecord: (id: string) =>
    installed.has(id)
      ? { id, status: "on", manifest: { version: installed.get(id) } }
      : undefined,
  setPluginEnabled: vi.fn(() => Promise.resolve()),
}));

const { installFromCatalog, loadCatalog, neededTextus, updateFor } =
  await import("./catalog");

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
