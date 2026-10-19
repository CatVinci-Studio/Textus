// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { useEffect, useLayoutEffect } from "react";
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
  htmlLang,
  loadSettings,
  normaliseSettings,
  resetSettingsStoreForTests,
  SettingsProvider,
  type Settings,
  UI_TEXT_SCALES,
  useSettings,
} from "./SettingsContext";
import { readFileSync } from "node:fs";
import { storage } from "../platform/ipc";
import { resetBootForTests } from "../storage/boot";
import {
  flushPendingWrites,
  resetPendingWritesForTests,
} from "../storage/pending-writes";
import { resetUiStateForTests } from "../storage/ui-state";
import { installTestLocalStorage } from "../dev/test-local-storage";

// The file-backed path: what runs when Rust booted the window with a
// snapshot (src/storage/boot.ts). The localStorage fallback is covered by
// SettingsContext.test.ts.

const handlers: Record<string, (event: { payload: unknown }) => void> = {};

vi.mock("../platform/ipc", () => ({
  ai: { setAiProxy: vi.fn().mockResolvedValue(null) },
  themes: { loadThemeCss: vi.fn().mockResolvedValue(null) },
  storage: {
    settingsGet: vi.fn(),
    settingsPatch: vi.fn(),
    settingsFillDefaults: vi.fn(),
    settingsImportLegacy: vi.fn(),
    uiStateGet: vi.fn().mockResolvedValue({}),
    uiStatePatch: vi.fn().mockResolvedValue(null),
    historyList: vi.fn().mockResolvedValue([]),
  },
}));
vi.mock("../utils/tauri-events", () => ({
  listenToThisWindow: (
    event: string,
    handler: (event: { payload: unknown }) => void,
  ) => {
    handlers[event] = handler;
    return Promise.resolve(() => {});
  },
}));

function boot(settings: Record<string, unknown>, extra: object = {}) {
  (window as unknown as { __BOOT__: unknown }).__BOOT__ = {
    settings,
    rev: 3,
    uiState: {},
    legacyImport: false,
    label: "main",
    ...extra,
  };
}

function remote(patch: Record<string, unknown>, rev: number, from = "w2") {
  act(() => handlers["settings-changed"]({ payload: { rev, patch, from } }));
}

const setter: { current?: ReturnType<typeof useSettings>["setSettings"] } = {};
const lastSet = (patch: Partial<Settings>) => setter.current!(patch);
function Probe() {
  const { settings, setSettings, t } = useSettings();
  useEffect(() => {
    setter.current = setSettings;
  });
  return (
    <div data-testid="probe">
      {settings.theme}|{settings.zoom}|{settings.customCss}|{t.settingsTitle}
    </div>
  );
}

beforeAll(installTestLocalStorage);

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  resetBootForTests();
  resetSettingsStoreForTests();
  resetUiStateForTests();
  resetPendingWritesForTests();
  vi.mocked(storage.settingsGet).mockReturnValue(new Promise(() => {}));
  vi.mocked(storage.settingsFillDefaults).mockReturnValue(
    new Promise(() => {}),
  );
  let rev = 3;
  vi.mocked(storage.settingsPatch).mockImplementation(async () => ++rev);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete (window as unknown as { __BOOT__?: unknown }).__BOOT__;
});

describe("file-backed settings", () => {
  it("reads the boot snapshot, not localStorage", () => {
    localStorage.setItem(
      "catvinci-settings",
      JSON.stringify({ theme: "light" }),
    );
    boot({ theme: "dark", language: "ja", languageChosen: true });
    const settings = loadSettings();
    expect(settings.theme).toBe("dark");
    expect(settings.language).toBe("ja");
    expect(storage.settingsGet).toHaveBeenCalledTimes(1);
  });

  it("sends only the fields that changed, and nothing to localStorage", () => {
    boot({ theme: "light", languageChosen: true });
    render(
      <SettingsProvider>
        <Probe />
      </SettingsProvider>,
    );
    act(() => lastSet({ theme: "dark", contentWidth: "auto" }));
    // contentWidth is already "auto" (the default) - nothing to send for it.
    expect(storage.settingsPatch).toHaveBeenCalledWith({ theme: "dark" });
    expect(localStorage.getItem("catvinci-settings")).toBeNull();
    expect(loadSettings().theme).toBe("dark");
  });

  it("sends every keystroke at once, so a quick quit can't lose it", () => {
    // Rust coalesces the disk writes and flushes on exit; a debounce here
    // lost whatever was typed in the last moments before Cmd+Q.
    boot({ languageChosen: true });
    render(
      <SettingsProvider>
        <Probe />
      </SettingsProvider>,
    );
    act(() => lastSet({ customCss: "/* a */" }));
    act(() => lastSet({ customCss: "/* ab */" }));
    act(() => lastSet({ customCss: "/* abc */" }));
    expect(storage.settingsPatch).toHaveBeenCalledTimes(3);
    expect(storage.settingsPatch).toHaveBeenLastCalledWith({
      customCss: "/* abc */",
    });
    expect(loadSettings().customCss).toBe("/* abc */");
  });

  it("applies other windows' changes, except zoom and its own echo", () => {
    boot({ theme: "light", zoom: 1.5, languageChosen: true });
    render(
      <SettingsProvider>
        <Probe />
      </SettingsProvider>,
    );
    const probe = screen.getByTestId("probe");
    remote({ theme: "dark", zoom: 2 }, 10);
    expect(probe.textContent).toContain("dark|1.5|");
    // An event this window's own patch caused is not applied twice (here:
    // it would be a stale value).
    remote({ theme: "light" }, 11, "main");
    expect(probe.textContent).toContain("dark|");
    expect(loadSettings().zoom).toBe(1.5);
  });

  it("corrects a stale boot snapshot once the live values arrive", async () => {
    let answer!: (s: { value: Record<string, unknown>; rev: number }) => void;
    vi.mocked(storage.settingsGet).mockReturnValue(
      new Promise((resolve) => (answer = resolve)),
    );
    boot({ theme: "light", zoom: 1.25, languageChosen: true });
    render(
      <SettingsProvider>
        <Probe />
      </SettingsProvider>,
    );
    await act(async () =>
      answer({
        value: { theme: "dark", zoom: 3, languageChosen: true },
        rev: 7,
      }),
    );
    // The window keeps its own zoom.
    expect(screen.getByTestId("probe").textContent).toContain("dark|1.25|");
  });

  it("keeps a change that lands before the provider has subscribed", () => {
    boot({ theme: "light", languageChosen: true });
    // A child's layout effect runs after the provider's first render but
    // before its own (passive) effect subscribes - the same gap the live
    // re-read or another window's event can fall into while React yields.
    function EarlyEvent() {
      useLayoutEffect(() => {
        // Straight to the handler: render() is already inside act().
        handlers["settings-changed"]({
          payload: { rev: 10, patch: { theme: "dark" }, from: "w2" },
        });
      }, []);
      return null;
    }
    render(
      <SettingsProvider>
        <EarlyEvent />
        <Probe />
      </SettingsProvider>,
    );
    expect(screen.getByTestId("probe").textContent).toContain("dark|");
  });

  it("hands localStorage to Rust on the first launch after the move", async () => {
    localStorage.setItem(
      "catvinci-settings",
      JSON.stringify({ theme: "dark", aiProvider: "codex" }),
    );
    localStorage.setItem("levis-chat-history", JSON.stringify([{ id: "c" }]));
    localStorage.setItem("levis-agent-panel-open", "1");
    vi.mocked(storage.settingsImportLegacy).mockResolvedValue({
      accepted: true,
      value: { theme: "dark", aiProvider: "openai", languageChosen: true },
      rev: 4,
    });
    boot({}, { legacyImport: true, rev: 1 });
    // Usable at once, from localStorage, before Rust has answered.
    expect(loadSettings().theme).toBe("dark");
    await Promise.resolve();
    const payload = vi.mocked(storage.settingsImportLegacy).mock.calls[0][0];
    // Normalised on the way: the old provider id is migrated.
    expect(payload.settings.aiProvider).toBe("openai");
    expect(payload.chatHistory).toEqual([{ id: "c" }]);
    expect(payload.uiState).toEqual({ agentPanelOpen: true });
    expect(storage.settingsGet).not.toHaveBeenCalled();
    // localStorage is kept as it was, for a downgrade.
    expect(localStorage.getItem("catvinci-settings")).toContain("codex");
  });

  it("writes fresh defaults out when Rust has nothing stored", async () => {
    vi.mocked(storage.settingsFillDefaults).mockImplementation(
      async (defaults) => ({ value: defaults, rev: 4 }),
    );
    boot({});
    expect(loadSettings().languageChosen).toBe(false);
    // Only ever as defaults for the fields still missing - never a patch.
    expect(storage.settingsPatch).not.toHaveBeenCalled();
    const sent = vi.mocked(storage.settingsFillDefaults).mock.calls[0][0];
    expect(sent.languageChosen).toBe(false);
    expect(sent.onboardingShown).toBe(false);
    await act(async () => {});
    expect(loadSettings().languageChosen).toBe(false);
  });

  it("doesn't put the defaults back over changes when it reloads with an empty snapshot", async () => {
    // A window that booted after a corrupt settings.json was moved aside
    // replays the same empty snapshot on every reload; meanwhile the user
    // has changed things. Rust keeps those (it only fills missing fields)
    // and answers with the live settings, which the window takes.
    vi.mocked(storage.settingsFillDefaults).mockResolvedValue({
      value: { theme: "dark", languageChosen: true, onboardingShown: true },
      rev: 9,
    });
    boot({});
    render(
      <SettingsProvider>
        <Probe />
      </SettingsProvider>,
    );
    await act(async () => {});
    expect(screen.getByTestId("probe").textContent).toContain("dark|");
    expect(loadSettings().languageChosen).toBe(true);
    expect(storage.settingsPatch).not.toHaveBeenCalled();
  });
});

describe("closing the window", () => {
  it("waits for Rust to take a change that is still on its way", async () => {
    let answer!: (rev: number) => void;
    vi.mocked(storage.settingsPatch).mockReturnValue(
      new Promise((resolve) => (answer = resolve)),
    );
    boot({ languageChosen: true });
    render(
      <SettingsProvider>
        <Probe />
      </SettingsProvider>,
    );
    act(() => lastSet({ customCss: "p { color: red }" }));
    // Sent at once - nothing waits for a pause in the typing.
    expect(storage.settingsPatch).toHaveBeenCalledWith({
      customCss: "p { color: red }",
    });
    // The window is closing while the patch is still on its way.
    let flushed = false;
    void flushPendingWrites().then(() => (flushed = true));
    await act(async () => {});
    // Not until Rust has answered: destroying the window now could drop it.
    expect(flushed).toBe(false);
    await act(async () => answer(5));
    expect(flushed).toBe(true);
    // The close sent nothing again: there was nothing held back.
    expect(storage.settingsPatch).toHaveBeenCalledTimes(1);
  });
});

describe("language", () => {
  it("falls back to English for a language it doesn't know", () => {
    expect(normaliseSettings({ language: "it" }).language).toBe("en");
    expect(normaliseSettings({ language: "ja" }).language).toBe("ja");
    expect(normaliseSettings({ language: "zh-Hant" }).language).toBe("zh-Hant");
  });

  it("starts a new installation in the system's language", () => {
    const spy = vi.spyOn(navigator, "language", "get");
    spy.mockReturnValue("zh-TW");
    expect(normaliseSettings(null).language).toBe("zh-Hant");
    spy.mockReturnValue("pt-BR");
    expect(normaliseSettings(null).language).toBe("pt");
    spy.mockReturnValue("it-IT");
    expect(normaliseSettings(null).language).toBe("en");
    spy.mockRestore();
  });

  it("renders instead of crashing on an unknown stored language", () => {
    boot({ language: "klingon", languageChosen: true });
    render(
      <SettingsProvider>
        <Probe />
      </SettingsProvider>,
    );
    expect(screen.getByTestId("probe").textContent).toContain("Settings");
    expect(document.documentElement.lang).toBe("en");
  });

  it("sets the document language for the CSS :lang() font stacks", () => {
    expect(htmlLang("zh")).toBe("zh-CN");
    expect(htmlLang("zh-Hant")).toBe("zh-TW");
    expect(htmlLang("ja")).toBe("ja");
    expect(htmlLang("en")).toBe("en");
    boot({ language: "zh", languageChosen: true });
    render(
      <SettingsProvider>
        <Probe />
      </SettingsProvider>,
    );
    expect(document.documentElement.lang).toBe("zh-CN");
  });
});

describe("interface text size", () => {
  it("keeps a size it offers and falls back to 100% for any other", () => {
    expect(normaliseSettings({ uiTextScale: 1.25 }).uiTextScale).toBe(1.25);
    expect(normaliseSettings({ uiTextScale: 3 }).uiTextScale).toBe(1);
    expect(normaliseSettings({ uiTextScale: "big" }).uiTextScale).toBe(1);
    expect(normaliseSettings(null).uiTextScale).toBe(1);
  });

  it("puts the size on the page for the UI's type scale, and takes it off at 100%", () => {
    boot({ uiTextScale: 1.1, languageChosen: true });
    render(
      <SettingsProvider>
        <Probe />
      </SettingsProvider>,
    );
    const root = document.documentElement;
    expect(root.style.getPropertyValue("--ui-text-scale")).toBe("1.1");
    act(() => lastSet({ uiTextScale: 1 }));
    expect(root.style.getPropertyValue("--ui-text-scale")).toBe("");
  });

  it("is applied by the boot script for the same sizes", () => {
    // Its own copy of UI_TEXT_SCALES, less 1 (the stylesheet's default).
    const script = readFileSync("src-tauri/src/boot.js", "utf8");
    const list = /\[([\d., ]+)\]\.indexOf\(settings\.uiTextScale\)/.exec(
      script,
    );
    expect(list?.[1].split(",").map(Number)).toEqual(
      UI_TEXT_SCALES.filter((scale) => scale !== 1),
    );
  });
});
