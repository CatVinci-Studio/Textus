// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SettingsProvider, useSettings } from "../../prefs/SettingsContext";
import { themes } from "../../platform/ipc";
import { ReplyThemes } from "./ReplyThemes";

vi.mock("../../platform/ipc", () => ({
  ai: { setAiProxy: vi.fn().mockResolvedValue(null) },
  themes: {
    loadThemeCss: vi.fn().mockResolvedValue(""),
    saveThemeCss: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock("../../theme/theme-chrome", () => ({
  applyThemeChrome: vi.fn(),
  clearThemeChrome: vi.fn(),
}));

const reply = readFileSync("src/theme/fixtures/theme-skill-reply.md", "utf8");
const labels = {
  useTheme: "Use this theme",
  themeInUse: "In use",
  themeFallbackName: "Theme",
};

function Current() {
  const { settings, setSettings } = useSettings();
  return (
    <>
      <output data-testid="current">
        {settings.themeId}|{settings.userThemes.map((t) => t.name).join(",")}
      </output>
      <button onClick={() => setSettings({ themeId: "paper" })}>Paper</button>
    </>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  const saved = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
    removeItem: (key: string) => saved.delete(key),
    clear: () => saved.clear(),
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.getElementById("textus-custom-theme")?.remove();
});

it("installs a reply's css block as a user theme and switches to it", async () => {
  render(
    <SettingsProvider>
      <ReplyThemes text={reply} labels={labels} />
      <Current />
    </SettingsProvider>,
  );
  expect(screen.getByText("Night Harbor")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Use this theme" }));

  await waitFor(() =>
    expect(screen.getByRole("button", { name: "In use" })).toBeTruthy(),
  );
  const [id, variant, css] = vi.mocked(themes.saveThemeCss).mock.calls[0];
  expect(id).toMatch(/^user-/);
  expect(variant).toBe("light");
  expect(css).toContain("--editor-accent: #5fc4b4;");
  expect(screen.getByTestId("current").textContent).toBe(`${id}|Night Harbor`);

  // Picking another theme and coming back reuses the saved copy.
  fireEvent.click(screen.getByText("Paper"));
  fireEvent.click(
    await screen.findByRole("button", { name: "Use this theme" }),
  );
  expect(screen.getByTestId("current").textContent).toBe(`${id}|Night Harbor`);
  expect(themes.saveThemeCss).toHaveBeenCalledTimes(1);
});

it("offers nothing under a reply without a theme", () => {
  render(
    <SettingsProvider>
      <ReplyThemes
        text={"Plain answer.\n\n```css\n.x {}\n```"}
        labels={labels}
      />
    </SettingsProvider>,
  );
  expect(screen.queryByRole("button")).toBeNull();
});
