// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveStrings } from "../../i18n/strings";
import { ResearchAtOnceRow } from "./agent";

const state = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
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
const row = () => screen.getByRole("combobox", { name: t.researchAtOnceLabel });

beforeEach(() => {
  state.settings = { researchAtOnce: 0 };
});

afterEach(() => {
  cleanup();
  state.setSettings.mockReset();
});

describe("ResearchAtOnceRow", () => {
  it("leaves the calls at once to the provider until one is chosen", () => {
    render(<ResearchAtOnceRow t={t} />);
    expect(row()).toHaveTextContent(t.researchAtOnceAuto);
  });

  it("keeps the number chosen", () => {
    render(<ResearchAtOnceRow t={t} />);
    fireEvent.click(row());
    fireEvent.click(screen.getByRole("option", { name: "6" }));
    expect(state.setSettings).toHaveBeenCalledWith({ researchAtOnce: 6 });
  });
});
