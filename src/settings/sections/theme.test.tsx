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
import { ThemeSection, ThemesTab } from "./theme";
import { fs, themes } from "../../platform/ipc";
const mock = vi.hoisted(() => ({
  setSettings: vi.fn(),
  settings: {
    theme: "system",
    themeId: "user-test",
    userThemes: [{ id: "user-test", name: "Test", hasDark: false }],
  },
}));
vi.mock("../../prefs/SettingsContext", () => ({
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
vi.mock("./theme-gallery", () => ({
  AvailableThemes: () => <p>available</p>,
  galleryUpdates: () => new Map(),
  useGalleryCatalog: () => ({ catalog: [], unreachable: false, retry() {} }),
  useGalleryInstall: () => ({ busy: false, error: null, install() {} }),
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
  it("leaves getting and editing themes to Extensions", () => {
    const t = resolveStrings("en");
    const onMore = vi.fn();
    render(<ThemeSection t={t} onMore={onMore} />);
    expect(
      screen.queryByRole("button", { name: t.themeImportButton }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: t.customCssLabel }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t.themeGetMore }));
    expect(onMore).toHaveBeenCalled();
  });
  it("lists the user's themes on the Extensions tab, the gallery's below, the rest behind ⋯ and Advanced", () => {
    const t = resolveStrings("en");
    render(<ThemesTab t={t} />);
    const row = screen.getByText("Test").closest(".plugin-card");
    expect(row).toHaveTextContent(t.themeGalleryInUse);
    // Importing and exporting wait behind "⋯"; the gallery's themes follow.
    expect(
      screen.queryByRole("menuitem", { name: t.themeImportButton }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t.toolbarMore }));
    expect(screen.getAllByRole("menuitem").map((m) => m.textContent)).toEqual([
      t.themeImportButton,
      t.themeExportButton,
    ]);
    expect(screen.getByText("available")).toBeInTheDocument();
    // The user's own CSS, folded under Advanced.
    expect(
      screen
        .getByRole("textbox", { name: t.customCssLabel, hidden: true })
        .closest("details"),
    ).not.toHaveAttribute("open");
  });
  it("shows picker errors and allows retry", async () => {
    vi.mocked(fs.openCssFileDialog).mockRejectedValueOnce(
      new Error("Cannot open picker"),
    );
    render(<ThemesTab t={resolveStrings("en")} />);
    const importItem = () => {
      fireEvent.click(
        screen.getByRole("button", { name: resolveStrings("en").toolbarMore }),
      );
      return screen.getByRole("menuitem", {
        name: resolveStrings("en").themeImportButton,
      });
    };
    fireEvent.click(importItem());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Cannot open picker",
    );
    await waitFor(() => expect(importItem()).toBeEnabled());
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
