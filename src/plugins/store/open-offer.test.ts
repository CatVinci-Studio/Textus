import { describe, expect, it, vi } from "vitest";
import { version as APP_VERSION } from "../../../package.json";
import type { Strings } from "../../i18n/strings";

// The network's catalog never arrives: a file opened meanwhile mustn't wait
// for it when last time's list is kept (#828: a script file's first open
// took seconds).
const ipc = {
  catalog: vi.fn(() => new Promise<never>(() => {})),
  cachedCatalog: vi.fn(() =>
    Promise.resolve([
      {
        id: "catvinci.html-view",
        version: "0.1.3",
        official: true,
        size: 1,
        screenshots: [],
        readme: {},
        manifest: {
          id: "catvinci.html-view",
          name: "HTML",
          version: "0.1.3",
          publisher: "catvinci",
          engines: { textus: `>=${APP_VERSION}` },
        },
      },
    ]),
  ),
  skillCatalog: vi.fn(() => Promise.resolve([])),
};
vi.mock("../../platform/ipc", () => ({ plugins: ipc }));
vi.mock("../manager", () => ({
  loadPlugins: vi.fn(() => Promise.resolve()),
}));

const { offerPluginToOpen } = await import("./open-offer");
const { catalogSnapshot } = await import("./catalog");

describe("which plugin opens a file", () => {
  it("is read from the kept catalog without waiting for the network's", async () => {
    const offered = await Promise.race([
      offerPluginToOpen("/notes/run.py", {} as Strings),
      new Promise<"waited">((resolve) =>
        setTimeout(() => resolve("waited"), 500),
      ),
    ]);
    expect(offered).toBe("none");
    expect(catalogSnapshot().status).toBe("ready");
    expect(ipc.catalog).toHaveBeenCalled();
  });
});
