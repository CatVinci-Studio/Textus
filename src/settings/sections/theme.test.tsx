// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveStrings } from "../../i18n/strings";
import { ThemeSection } from "./theme";
import { fs, themes } from "../../platform/ipc";
const mock = vi.hoisted(() => ({
  setSettings: vi.fn(),
  settings: {
    theme: "system",
    themeId: "user-test",
    aiProvider: "openai",
    userThemes: [{ id: "user-test", name: "Test", hasDark: false }],
  },
}));
vi.mock("../SettingsContext", () => ({
  useSettings: () => mock,
  THEME_MODES: ["system", "light", "dark"],
}));
vi.mock("../../theme/builtin-themes", () => ({
  BUILTIN_CONTENT_THEMES: [
    { id: "default", nameKey: "themeNameDefault" },
    { id: "diary", nameKey: "themeNameDiary" },
  ],
  MAGIC_DIARY_THEME: "diary",
}));
const connected = vi.hoisted(() => ({ value: false }));
vi.mock("../../ai/provider-catalog", () => ({
  useProviderCatalog: () => [{ id: "openai" }],
}));
vi.mock("./providers", () => ({
  fetchConnected: () =>
    Promise.resolve({ oauth: connected.value, apiKey: false }),
}));
vi.mock("../../platform/capabilities", async (real) => ({
  ...(await real<typeof import("../../platform/capabilities")>()),
  isDesktopApp: true,
}));
vi.mock("../../platform/ipc", () => ({
  fs: { openCssFileDialog: vi.fn() },
  themes: { deleteTheme: vi.fn(), saveThemeCss: vi.fn() },
}));
vi.mock("../../theme/theme-import", () => ({
  importThemeCss: vi.fn().mockResolvedValue("body{}"),
}));
afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());
describe("theme settings", () => {
  it("offers the Magic Diary theme only once an AI provider is connected", async () => {
    const t = resolveStrings("en");
    const options = async () => {
      fireEvent.click(
        screen.getByRole("combobox", { name: t.contentThemeLabel }),
      );
      await screen.findByRole("option", { name: "Default" });
      return screen.queryByRole("option", { name: "Magic Diary" });
    };
    connected.value = false;
    const { unmount } = render(<ThemeSection t={t} />);
    await new Promise((r) => setTimeout(r, 0));
    expect(await options()).toBeNull();
    unmount();
    connected.value = true;
    render(<ThemeSection t={t} />);
    await waitFor(async () => expect(await options()).not.toBeNull());
  });
  it("offers named appearance choices with the current selection", () => {
    render(<ThemeSection t={resolveStrings("en")} />);
    expect(screen.getByRole("radio", { name: "Follow system" })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: "Dark" }));
    expect(mock.setSettings).toHaveBeenCalledWith({ theme: "dark" });
  });
  it("shows picker errors and allows retry", async () => {
    vi.mocked(fs.openCssFileDialog).mockRejectedValueOnce(
      new Error("Cannot open picker"),
    );
    render(<ThemeSection t={resolveStrings("en")} />);
    fireEvent.click(
      screen.getByRole("button", {
        name: resolveStrings("en").themeImportButton,
      }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Cannot open picker",
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", {
          name: resolveStrings("en").themeImportButton,
        }),
      ).toBeEnabled(),
    );
  });
  it("keeps the selected theme after deletion fails", async () => {
    vi.mocked(themes.deleteTheme).mockRejectedValueOnce(
      new Error("Read-only folder"),
    );
    render(<ThemeSection t={resolveStrings("en")} />);
    fireEvent.click(
      screen.getByRole("button", {
        name: resolveStrings("en").themeDeleteButton,
      }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Read-only folder",
    );
    expect(mock.setSettings).not.toHaveBeenCalled();
  });
});
