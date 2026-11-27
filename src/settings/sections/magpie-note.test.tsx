// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import en from "../../i18n/locales/en";
import { MagpieNote } from "./magpie-note";

const setSettings = vi.fn();
let aiProvider = "openai";
const fetchAgentModels = vi.fn();

vi.mock("../../prefs/SettingsContext", () => ({
  useSettings: () => ({ settings: { aiProvider }, setSettings }),
}));
vi.mock("../../platform/ipc", () => ({
  ai: { fetchAgentModels: (p: string) => fetchAgentModels(p) },
}));

afterEach(cleanup);

beforeEach(() => {
  localStorage.clear();
  setSettings.mockReset();
  fetchAgentModels.mockReset();
  aiProvider = "openai";
});

it("offers Magpie when it answers on this computer, and switches to it", async () => {
  fetchAgentModels.mockResolvedValue(["claude/claude-sonnet-5-5"]);
  await act(async () => {
    render(<MagpieNote t={en} />);
  });
  expect(fetchAgentModels).toHaveBeenCalledWith("magpie");
  fireEvent.click(screen.getByRole("button", { name: en.magpieUse }));
  expect(setSettings).toHaveBeenCalledWith({ aiProvider: "magpie" });
});

it("says nothing when Magpie isn't running, or is already in use", async () => {
  fetchAgentModels.mockRejectedValue("connection refused");
  const { container } = await act(async () => render(<MagpieNote t={en} />));
  expect(container.textContent).toBe("");
  aiProvider = "magpie";
  fetchAgentModels.mockResolvedValue(["x"]);
  const again = await act(async () => render(<MagpieNote t={en} />));
  expect(again.container.textContent).toBe("");
});

it("put away, stays away", async () => {
  fetchAgentModels.mockResolvedValue(["x"]);
  const first = await act(async () => render(<MagpieNote t={en} />));
  fireEvent.click(screen.getByRole("button", { name: en.magpieDismiss }));
  expect(first.container.textContent).toBe("");
  first.unmount();
  const second = await act(async () => render(<MagpieNote t={en} />));
  expect(second.container.textContent).toBe("");
});
