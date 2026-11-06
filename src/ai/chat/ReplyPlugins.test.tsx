// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SettingsProvider, useSettings } from "../../prefs/SettingsContext";
import { ReplyPlugins, type ReplyPluginLabels } from "./ReplyPlugins";
import { askAi } from "./ask-ai";

vi.mock("./ask-ai", () => ({ askAi: vi.fn() }));
vi.mock("../../plugins/manager", () => {
  const none = { loaded: true, allOn: true, records: [] };
  return {
    installPlugin: vi.fn(async () => "local.toggle"),
    setPluginEnabled: vi.fn(async () => {}),
    pluginsSnapshot: () => none,
    subscribePlugins: () => () => {},
  };
});

vi.mock("../../platform/ipc", () => ({
  ai: { setAiProxy: vi.fn().mockResolvedValue(null) },
}));

beforeEach(() => {
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
});

function Creations() {
  const { settings } = useSettings();
  return (
    <output data-testid="creations">
      {settings.creations.map((c) => `${c.kind}:${c.id}:${c.name}`).join(",")}
    </output>
  );
}

const labels: ReplyPluginLabels = {
  installPlugin: "Install",
  updatePlugin: "Update",
  pluginInstalled: "Installed",
  usageGuide: "Guide",
  exportPlugin: "Export",
  pluginCantInstall: "Can't: {reason}",
  pluginCheck: {
    dom: "Draws on the page.",
    permission: "Uses {permission}.",
    unregistered: "Declares {id}.",
    runError: "Stopped: {error}",
    fix: "Fix with AI",
    fixRequest: "{name} has:\n{problems}",
  },
  permission: (p) => p,
  language: "en",
};

const manifest = JSON.stringify({
  id: "local.toggle",
  name: "Toggle",
  version: "0.1.0",
  publisher: "local",
  description: "Toggles.",
  engines: { textus: ">=1.3.0" },
  main: "host.js",
  permissions: [],
});

const reply = [
  "```json textus-plugin.json",
  manifest,
  "```",
  "```js host.js",
  "exports.activate = () => document.body.appendChild(document.createElement('button'));",
  "```",
].join("\n");

it("says what a plugin's code will get wrong and asks the AI to fix it", () => {
  render(
    <SettingsProvider>
      <ReplyPlugins text={reply} labels={labels} />
    </SettingsProvider>,
  );
  expect(screen.getByText("Draws on the page.")).toBeTruthy();
  fireEvent.click(screen.getByText("Fix with AI"));
  expect(askAi).toHaveBeenCalledWith(
    "Toggle (local.toggle) has:\n- Draws on the page.",
    "create",
  );
});

it("remembers a plugin it installed for Create's list", async () => {
  render(
    <SettingsProvider>
      <ReplyPlugins text={reply} labels={labels} />
      <Creations />
    </SettingsProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Install" }));
  await waitFor(() =>
    expect(screen.getByTestId("creations").textContent).toBe(
      "plugin:local.toggle:Toggle",
    ),
  );
});
