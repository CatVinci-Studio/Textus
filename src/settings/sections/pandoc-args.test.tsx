// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveStrings } from "../../i18n/strings";
import { exportDoc } from "../../platform/ipc";
import { PandocArgsRows } from "./pandoc-args";

const state = vi.hoisted(() => ({
  settings: { pandocArgs: { all: ["--toc-depth=2"] } } as Record<
    string,
    unknown
  >,
  setSettings: vi.fn(),
}));

vi.mock("../../prefs/SettingsContext", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../prefs/SettingsContext")>()),
  useSettings: () => ({
    settings: state.settings,
    setSettings: state.setSettings,
  }),
}));

const t = resolveStrings("en");

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  state.setSettings.mockClear();
});

describe("Pandoc arguments", () => {
  it("keeps a format's arguments as their words, quotes and all", async () => {
    vi.spyOn(exportDoc, "checkPandocArgs").mockResolvedValue(null);
    render(<PandocArgsRows t={t} />);
    fireEvent.click(screen.getByRole("combobox", { name: "Pandoc arguments" }));
    fireEvent.click(screen.getByRole("option", { name: "LaTeX" }));
    const input = screen.getByLabelText("Pandoc arguments: LaTeX");
    fireEvent.change(input, {
      target: { value: '-V "mainfont=Noto Serif"' },
    });
    fireEvent.blur(input);
    await waitFor(() =>
      expect(state.setSettings).toHaveBeenCalledWith({
        pandocArgs: {
          all: ["--toc-depth=2"],
          latex: ["-V", "mainfont=Noto Serif"],
        },
      }),
    );
  });

  it("refuses an argument the export owns, saying which", async () => {
    vi.spyOn(exportDoc, "checkPandocArgs").mockResolvedValue("-o");
    render(<PandocArgsRows t={t} />);
    const input = screen.getByLabelText("Pandoc arguments: All formats");
    expect(input).toHaveValue("--toc-depth=2");
    fireEvent.change(input, { target: { value: "-o out.docx" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(
      await screen.findByText("-o is set by Textus; take it out."),
    ).toBeInTheDocument();
    expect(state.setSettings).not.toHaveBeenCalled();
  });
});
