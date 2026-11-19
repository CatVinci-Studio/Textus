import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveStrings } from "../../i18n/strings";

const state = vi.hoisted(() => ({
  installed: false,
  offered: undefined as string[] | undefined,
  answer: "later" as string,
  cards: 0,
  takenUp: 0,
  folder: null as string | null,
  apps: [] as string[],
}));

vi.mock("../../platform/ipc", () => ({
  fs: {
    folderConventions: async () => ({
      sources: state.apps.map((app) => ({ app, root: state.folder })),
    }),
  },
}));
vi.mock("../../platform/open-folder", () => ({
  openFolderOnDisk: () => state.folder,
}));
vi.mock("../../storage/ui-state", () => ({
  uiList: () => state.offered ?? [],
  keepInList: (_key: string, item: string) => {
    state.offered = [...(state.offered ?? []), item];
  },
}));
vi.mock("./plugin-records", () => ({
  pluginRecord: () => (state.installed ? { status: "on" } : undefined),
}));
vi.mock("./catalog", () => ({
  loadCatalog: async () => {},
  catalogSnapshot: () => ({
    status: "ready",
    items: [{ id: "catvinci.logseq", official: true }],
  }),
}));
vi.mock("./open-offer", () => ({
  takeUp: async () => {
    state.takenUp++;
    return true;
  },
}));
vi.mock("./plugin-card", () => ({
  showPluginCard: async () => {
    state.cards++;
    return state.answer;
  },
}));

const { offerMovedFeatures } = await import("./moved-offer");
const t = resolveStrings("en");

describe("offerMovedFeatures", () => {
  beforeEach(() => {
    Object.assign(state, {
      installed: false,
      offered: undefined,
      answer: "later",
      cards: 0,
      takenUp: 0,
      folder: null,
      apps: [],
    });
  });

  it("offers Logseq Folders once to whoever opens a Logseq graph", async () => {
    state.folder = "/graph";
    state.apps = ["logseq"];
    state.answer = "install";
    await offerMovedFeatures(t);
    expect(state.cards).toBe(1);
    expect(state.takenUp).toBe(1);
    await offerMovedFeatures(t);
    expect(state.cards).toBe(1);
  });

  it("says nothing to whoever has the plugin", async () => {
    state.folder = "/graph";
    state.apps = ["logseq"];
    state.installed = true;
    await offerMovedFeatures(t);
    expect(state.cards).toBe(0);
    expect(state.offered).toEqual(["logseq-settings"]);
  });

  it("asks again as folders open, until a Logseq graph is open", async () => {
    await offerMovedFeatures(t);
    expect(state.cards).toBe(0);
    expect(state.offered).toBeUndefined();
    state.folder = "/graph";
    state.apps = ["logseq"];
    await offerMovedFeatures(t);
    expect(state.cards).toBe(1);
    expect(state.offered).toEqual(["logseq-settings"]);
  });
});
