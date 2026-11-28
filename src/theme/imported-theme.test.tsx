// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { useEffect } from "react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  resetSettingsStoreForTests,
  SettingsProvider,
  type Settings,
  useSettings,
} from "../prefs/SettingsContext";
import { AppearanceSync } from "./apply-appearance";
import { storage, themes } from "../platform/ipc";
import { resetBootForTests } from "../storage/boot";
import { resetPendingWritesForTests } from "../storage/pending-writes";
import { resetUiStateForTests } from "../storage/ui-state";
import { installTestLocalStorage } from "../dev/test-local-storage";
import { motionAllowed } from "../engine/motion/motion";

vi.mock("../platform/ipc", () => ({
  themes: { loadThemeCss: vi.fn() },
  webAssets: {},
  storage: {
    settingsGet: vi.fn(),
    settingsPatch: vi.fn(),
    settingsFillDefaults: vi.fn(),
    uiStateGet: vi.fn().mockResolvedValue({}),
    uiStatePatch: vi.fn().mockResolvedValue(null),
    historyList: vi.fn().mockResolvedValue([]),
  },
}));
// jsdom moves nothing; one test lets the window's cross-fade run.
vi.mock("../engine/motion/motion", async (actual) => {
  const real = await actual<typeof import("../engine/motion/motion")>();
  return { ...real, motionAllowed: vi.fn(real.motionAllowed) };
});
vi.mock("../platform/events", () => ({
  listenToThisWindow: () => Promise.resolve(() => {}),
}));

const CSS = {
  light: "#write { color: rgb(1, 1, 1); }",
  dark: "#write { color: rgb(2, 2, 2); }",
};
const THEME = { id: "t", name: "T", hasDark: true };
const root = document.documentElement;
const themeCss = () =>
  document.getElementById("textus-custom-theme")?.textContent ?? "";

const setter: { current?: (patch: Partial<Settings>) => void } = {};
function Probe() {
  const { setSettings } = useSettings();
  useEffect(() => {
    setter.current = setSettings;
  });
  return null;
}

function start(settings: Record<string, unknown>) {
  (window as unknown as { __BOOT__: unknown }).__BOOT__ = {
    settings: { languageChosen: true, userThemes: [THEME], ...settings },
    rev: 3,
    uiState: {},
    label: "main",
  };
  render(
    <SettingsProvider>
      <AppearanceSync />
      <Probe />
    </SettingsProvider>,
  );
}

beforeAll(installTestLocalStorage);

beforeEach(() => {
  resetBootForTests();
  resetSettingsStoreForTests();
  resetUiStateForTests();
  resetPendingWritesForTests();
  vi.mocked(storage.settingsGet).mockReturnValue(new Promise(() => {}));
  vi.mocked(storage.settingsFillDefaults).mockReturnValue(
    new Promise(() => {}),
  );
  vi.mocked(storage.settingsPatch).mockResolvedValue(4);
});

afterEach(() => {
  cleanup();
  document.getElementById("textus-custom-theme")?.remove();
  for (const name of ["data-theme", "data-content-theme", "data-user-theme"])
    root.removeAttribute(name);
});

describe("an imported theme", () => {
  it("swaps its light and dark designs in the frame the appearance flips", async () => {
    vi.mocked(themes.loadThemeCss).mockImplementation(async (_id, design) =>
      Promise.resolve(CSS[design]),
    );
    start({ themeId: "t", theme: "light" });
    await vi.waitFor(() => expect(themeCss()).toContain("rgb(1, 1, 1)"));
    // Settled: both designs read once the first is shown.
    await act(() => new Promise((done) => setTimeout(done, 50)));
    act(() => setter.current!({ theme: "dark" }));
    expect(root.dataset.theme).toBe("dark");
    expect(themeCss()).toContain("rgb(2, 2, 2)");
  });

  it("leaves the built-in theme on the page until its own stylesheet is in", async () => {
    let arrive: (css: string | null) => void = () => {};
    vi.mocked(themes.loadThemeCss).mockImplementation(
      () => new Promise((done) => (arrive = done)),
    );
    start({ themeId: "paper", theme: "light" });
    expect(root.dataset.contentTheme).toBe("paper");
    act(() => setter.current!({ themeId: "t" }));
    expect(root.dataset.contentTheme).toBe("paper");
    expect(root.hasAttribute("data-user-theme")).toBe(false);
    await act(async () => arrive(CSS.light));
    await vi.waitFor(() => expect(themeCss()).toContain("rgb(1, 1, 1)"));
    expect(root.hasAttribute("data-content-theme")).toBe(false);
    expect(root.hasAttribute("data-user-theme")).toBe(true);
  });

  it("keeps the cross-fade's old picture until a theme not read yet is in", async () => {
    let arrive: (css: string | null) => void = () => {};
    vi.mocked(themes.loadThemeCss).mockImplementation(
      () => new Promise((done) => (arrive = done)),
    );
    let picture: () => unknown = () => {};
    document.startViewTransition = ((update: () => unknown) => {
      picture = update;
      const finished = Promise.resolve();
      return { ready: finished, finished, skipTransition: () => {} };
    }) as never;
    vi.mocked(motionAllowed).mockReturnValue(true);
    try {
      start({ themeId: "paper", theme: "light" });
      act(() => setter.current!({ themeId: "t" }));
      const pictured = vi.fn();
      await act(async () => {
        void Promise.resolve(picture()).then(pictured);
      });
      // The fade waits on the stylesheet...
      expect(pictured).not.toHaveBeenCalled();
      await act(async () => arrive(CSS.light));
      // ...and goes on once it is on the page.
      await vi.waitFor(() => expect(pictured).toHaveBeenCalled());
      expect(themeCss()).toContain("rgb(1, 1, 1)");
    } finally {
      vi.mocked(motionAllowed).mockReset();
      delete (document as { startViewTransition?: unknown })
        .startViewTransition;
    }
  });
});
