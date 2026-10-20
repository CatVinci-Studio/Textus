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
import { MoreThemesSection, ThemeSection } from "./theme";
import { fs, themes } from "../../platform/ipc";
const mock = vi.hoisted(() => ({
  setSettings: vi.fn(),
  settings: {
    theme: "system",
    themeId: "user-test",
    userThemes: [{ id: "user-test", name: "Test", hasDark: false }],
  },
}));
vi.mock("../SettingsContext", () => ({
  useSettings: () => mock,
  THEME_MODES: ["system", "light", "dark"],
}));
vi.mock("../../theme/builtin-themes", () => ({
  BUILTIN_CONTENT_THEMES: [{ id: "default", nameKey: "themeNameDefault" }],
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
  it("offers named appearance choices with the current selection", () => {
    render(<ThemeSection t={resolveStrings("en")} onMore={() => {}} />);
    expect(screen.getByRole("radio", { name: "Follow system" })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: "Dark" }));
    expect(mock.setSettings).toHaveBeenCalledWith({ theme: "dark" });
  });
  it("keeps getting and editing themes on the More themes page", () => {
    const t = resolveStrings("en");
    const onMore = vi.fn();
    render(<ThemeSection t={t} onMore={onMore} />);
    expect(
      screen.queryByRole("button", { name: t.themeImportButton }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: t.customCssLabel }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t.themeMoreLabel }));
    expect(onMore).toHaveBeenCalled();
    cleanup();
    const onBrowse = vi.fn();
    render(<MoreThemesSection t={t} onBrowse={onBrowse} />);
    expect(
      screen.getByRole("button", { name: t.themeImportButton }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: t.customCssLabel }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t.themeGalleryBrowse }));
    expect(onBrowse).toHaveBeenCalled();
  });
  it("shows picker errors and allows retry", async () => {
    vi.mocked(fs.openCssFileDialog).mockRejectedValueOnce(
      new Error("Cannot open picker"),
    );
    render(<MoreThemesSection t={resolveStrings("en")} onBrowse={() => {}} />);
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
    render(<ThemeSection t={resolveStrings("en")} onMore={() => {}} />);
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
