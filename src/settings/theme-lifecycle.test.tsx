// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SettingsProvider, useSettings } from "./SettingsContext";
import { themes } from "../platform/ipc";
import { applyThemeChrome } from "../theme/theme-chrome";
import { AppearanceSync } from "../theme/apply-appearance";
vi.mock("../platform/ipc", () => ({
  ai: { setAiProxy: vi.fn().mockResolvedValue(null) },
  themes: { loadThemeCss: vi.fn() },
}));
vi.mock("../theme/theme-chrome", () => ({
  applyThemeChrome: vi.fn(),
  clearThemeChrome: () =>
    document.getElementById("textus-imported-chrome")?.remove(),
}));
function Controls() {
  const { setSettings } = useSettings();
  return (
    <>
      <button onClick={() => setSettings({ themeId: "default" })}>
        Default
      </button>
      <button onClick={() => setSettings({ theme: "dark" })}>Dark</button>
    </>
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  const saved = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
    clear: () => saved.clear(),
  });
  localStorage.setItem(
    "catvinci-settings",
    JSON.stringify({
      theme: "light",
      themeId: "sample",
      userThemes: [{ id: "sample", name: "Sample", hasDark: true }],
    }),
  );
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
  document.getElementById("textus-custom-theme")?.remove();
  document.getElementById("textus-imported-chrome")?.remove();
});
it("applies imported chrome and removes both styles on returning to default", async () => {
  vi.mocked(themes.loadThemeCss).mockResolvedValue("body { color: green; }");
  render(
    <SettingsProvider>
      <AppearanceSync />
      <Controls />
    </SettingsProvider>,
  );
  await waitFor(() =>
    expect(applyThemeChrome).toHaveBeenCalledWith(
      "body { color: green; }",
      false,
    ),
  );
  const derived = document.createElement("style");
  derived.id = "textus-imported-chrome";
  document.head.appendChild(derived);
  fireEvent.click(screen.getByText("Default"));
  expect(document.getElementById("textus-custom-theme")).toBeNull();
  expect(document.getElementById("textus-imported-chrome")).toBeNull();
});
it("does not let a late light-theme response replace a newer dark selection", async () => {
  let resolveLight!: (css: string) => void;
  vi.mocked(themes.loadThemeCss).mockImplementation((_id, variant) =>
    variant === "light"
      ? new Promise((resolve) => {
          resolveLight = resolve;
        })
      : Promise.resolve("body { color: white; }"),
  );
  render(
    <SettingsProvider>
      <AppearanceSync />
      <Controls />
    </SettingsProvider>,
  );
  fireEvent.click(screen.getByText("Dark"));
  await waitFor(() =>
    expect(applyThemeChrome).toHaveBeenCalledWith(
      "body { color: white; }",
      true,
    ),
  );
  await act(async () => {
    resolveLight("body { color: black; }");
  });
  expect(document.getElementById("textus-custom-theme")?.textContent).toBe(
    "body { color: white; }",
  );
  expect(applyThemeChrome).toHaveBeenCalledTimes(1);
});
it("does not restore an import after switching to a built-in theme", async () => {
  let finish!: (css: string) => void;
  vi.mocked(themes.loadThemeCss).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(
    <SettingsProvider>
      <AppearanceSync />
      <Controls />
    </SettingsProvider>,
  );
  fireEvent.click(screen.getByText("Default"));
  await act(async () => {
    finish("body { background: black; }");
  });
  expect(document.getElementById("textus-custom-theme")).toBeNull();
  expect(applyThemeChrome).not.toHaveBeenCalled();
});
