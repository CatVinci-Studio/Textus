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
import { ai } from "../../platform/ipc";
import { showConfirm } from "../../ui/app-dialog";
import { OwnSkillsList } from "./skills";

const mock = vi.hoisted(() => ({
  setSettings: vi.fn(),
  settings: {
    language: "en",
    creations: [{ kind: "skill", id: "tidy", name: "Tidy", at: 1 }],
  },
}));
vi.mock("../../prefs/SettingsContext", () => ({ useSettings: () => mock }));
vi.mock("../../ui/app-dialog", () => ({ showConfirm: vi.fn() }));
vi.mock("../../platform/ipc", () => ({
  ai: {
    listSkills: vi.fn(),
    loadAgentWorkspace: vi.fn(),
    deleteGlobalSkill: vi.fn(),
    setSkillOff: vi.fn(),
    setSkillModes: vi.fn(),
  },
}));

const t = resolveStrings("en");
const skill = (name: string, source: string) => ({
  name,
  description: `${name} things`,
  category: null,
  invocation: "auto",
  source,
  modes: ["write"],
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(ai.listSkills).mockResolvedValue([
    skill("tidy", "global"),
    skill("house-style", "project"),
  ] as never);
  vi.mocked(ai.loadAgentWorkspace).mockResolvedValue(null as never);
  vi.mocked(ai.deleteGlobalSkill).mockResolvedValue(["/skills/tidy.md"]);
});
afterEach(cleanup);

describe("the user's skills", () => {
  it("tags one made in Create, and only a global skill can be deleted", async () => {
    render(<OwnSkillsList t={t} />);
    const tidy = await screen.findByText("tidy", {
      selector: ".settings-skill-name",
    });
    const row = tidy.closest(".settings-skill-item")!;
    expect(row).toHaveTextContent(t.madeByTextusAi);
    expect(screen.getAllByRole("button", { name: t.skillDelete })).toHaveLength(
      1,
    );
  });

  it("deletes after asking, and closes what was open on its files", async () => {
    vi.mocked(showConfirm).mockResolvedValue(true);
    const onFilesDeleted = vi.fn();
    render(<OwnSkillsList t={t} onFilesDeleted={onFilesDeleted} />);
    fireEvent.click(await screen.findByRole("button", { name: t.skillDelete }));
    await waitFor(() =>
      expect(onFilesDeleted).toHaveBeenCalledWith(["/skills/tidy.md"]),
    );
    expect(ai.deleteGlobalSkill).toHaveBeenCalledWith("tidy");
    expect(mock.setSettings).toHaveBeenCalledWith({ creations: [] });
  });

  it("keeps the skill when the ask is declined", async () => {
    vi.mocked(showConfirm).mockResolvedValue(false);
    render(<OwnSkillsList t={t} />);
    fireEvent.click(await screen.findByRole("button", { name: t.skillDelete }));
    await waitFor(() => expect(showConfirm).toHaveBeenCalled());
    expect(ai.deleteGlobalSkill).not.toHaveBeenCalled();
  });
});
