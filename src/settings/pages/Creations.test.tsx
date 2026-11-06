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
import en from "../../i18n/locales/en";
import type { Settings } from "../../prefs/settings-types";
import { Creations } from "./Creations";

const state = vi.hoisted(() => ({
  settings: {} as Partial<Settings>,
  setSettings: vi.fn(),
}));
vi.mock("../../prefs/SettingsContext", () => ({
  useSettings: () => ({
    settings: state.settings,
    setSettings: state.setSettings,
  }),
}));
const ipc = vi.hoisted(() => ({
  ai: {
    listSkills: vi.fn(async () => [
      { name: "tidy", source: "global", modes: ["write"], off: false },
    ]),
    setSkillOff: vi.fn(async () => null),
    deleteGlobalSkill: vi.fn(async () => []),
  },
  themes: {
    deleteTheme: vi.fn(async () => null),
    loadThemeCss: vi.fn(async () => ":root { --doc-accent: red; }"),
  },
}));
vi.mock("../../platform/ipc", () => ipc);
const manager = vi.hoisted(() => ({
  uninstallPlugin: vi.fn(async () => {}),
  setPluginEnabled: vi.fn(async () => {}),
}));
vi.mock("../../plugins/manager", () => {
  const snapshot = {
    loaded: true,
    allOn: true,
    records: [{ id: "local.todo", status: "off" }],
  };
  return {
    ...manager,
    pluginsSnapshot: () => snapshot,
    subscribePlugins: () => () => {},
  };
});
vi.mock("../../ui/app-dialog", () => ({
  showConfirm: vi.fn(async () => true),
}));

const kindLabel = { plugin: "Plugins", theme: "Themes", skill: "Skills" };

beforeEach(() => {
  vi.clearAllMocks();
  state.settings = {
    textusAi: true,
    themeId: "user-1",
    userThemes: [{ id: "user-1", name: "Night", hasDark: false }],
    creations: [
      { kind: "plugin", id: "local.todo", name: "Todo", at: 1 },
      { kind: "theme", id: "user-1", name: "Night", at: 3 },
      { kind: "skill", id: "tidy", name: "Tidy", at: 2 },
      { kind: "plugin", id: "local.gone", name: "Gone", at: 4 },
    ],
  };
});
afterEach(cleanup);

async function renderList(onEdit = vi.fn(), onOpenTab = vi.fn()) {
  render(
    <Creations
      t={en}
      kindLabel={kindLabel}
      inBar={false}
      onOpenTab={onOpenTab}
      onEdit={onEdit}
    />,
  );
  await act(async () => {});
}

it("lists what Create made and is still installed, newest first", async () => {
  await renderList();
  const rows = screen.getAllByRole("listitem").map((li) => li.textContent);
  expect(rows).toEqual([
    expect.stringContaining("Night"),
    expect.stringContaining("Tidy"),
    expect.stringContaining("Todo"),
  ]);
  expect(rows[0]).toContain(en.createdInUse);
  expect(rows[2]).toContain(en.createdOff);
});

it("turns a made plugin on and opens it in its own tab", async () => {
  const onOpenTab = vi.fn();
  await renderList(vi.fn(), onOpenTab);
  const todo = screen.getByText("Todo").closest("li")!;
  fireEvent.click(todo.querySelector("button")!);
  await waitFor(() =>
    expect(manager.setPluginEnabled).toHaveBeenCalledWith("local.todo", true),
  );
  fireEvent.click(
    [...todo.querySelectorAll("button")].find(
      (b) => b.textContent === en.createdOpen,
    )!,
  );
  expect(onOpenTab).toHaveBeenCalledWith("plugins");
});

it("asks to change a theme with its CSS", async () => {
  const onEdit = vi.fn();
  await renderList(onEdit);
  const night = screen.getByText("Night").closest("li")!;
  fireEvent.click(
    [...night.querySelectorAll("button")].find(
      (b) => b.textContent === en.createdEdit,
    )!,
  );
  await waitFor(() => expect(onEdit).toHaveBeenCalled());
  const [kind, text] = onEdit.mock.calls[0];
  expect(kind).toBe("theme");
  expect(text).toContain("Night");
  expect(text).toContain("--doc-accent: red;");
});

it("removes everything from its own store, and forgets it", async () => {
  await renderList();
  fireEvent.click(screen.getByText(en.createdRemoveAll));
  await waitFor(() => expect(state.setSettings).toHaveBeenCalled());
  expect(manager.uninstallPlugin).toHaveBeenCalledWith("local.todo");
  expect(ipc.themes.deleteTheme).toHaveBeenCalledWith("user-1");
  expect(ipc.ai.deleteGlobalSkill).toHaveBeenCalledWith("tidy");
  // The one already gone elsewhere stays remembered; the theme in use
  // gives way to the default.
  expect(state.setSettings).toHaveBeenCalledWith({
    creations: [{ kind: "plugin", id: "local.gone", name: "Gone", at: 4 }],
    userThemes: [],
    themeId: "default",
  });
});
