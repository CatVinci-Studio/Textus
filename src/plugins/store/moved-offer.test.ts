import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveStrings } from "../../i18n/strings";

const state = vi.hoisted(() => ({
  history: [] as unknown[],
  installed: false,
  offered: undefined as string[] | undefined,
  answer: "later" as string,
  cards: 0,
  takenUp: 0,
}));

vi.mock("../../platform/ipc", () => ({
  storage: { historyList: async () => state.history },
}));
vi.mock("../../storage/ui-state", () => ({
  getUiState: () => state.offered,
  setUiState: (_key: string, value: string[]) => {
    state.offered = value;
  },
}));
vi.mock("../manager", () => ({
  pluginRecord: () => (state.installed ? { status: "on" } : undefined),
}));
vi.mock("./catalog", () => ({
  loadCatalog: async () => {},
  catalogSnapshot: () => ({
    status: "ready",
    items: [{ id: "catvinci.clipboard-history", official: true }],
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
      history: [],
      installed: false,
      offered: undefined,
      answer: "later",
      cards: 0,
      takenUp: 0,
    });
  });

  it("offers Clipboard History once to whoever had a clipboard history", async () => {
    state.history = [{ text: "copied", at: 1 }];
    state.answer = "install";
    await offerMovedFeatures(t);
    expect(state.cards).toBe(1);
    expect(state.takenUp).toBe(1);
    await offerMovedFeatures(t);
    expect(state.cards).toBe(1);
  });

  it("says nothing to whoever never used it, or has the plugin", async () => {
    await offerMovedFeatures(t);
    state.offered = undefined;
    state.history = [{ text: "copied", at: 1 }];
    state.installed = true;
    await offerMovedFeatures(t);
    expect(state.cards).toBe(0);
    expect(state.offered).toEqual(["clipboard-history"]);
  });
});
