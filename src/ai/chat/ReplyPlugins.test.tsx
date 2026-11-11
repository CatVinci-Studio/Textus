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
  showCode: "Show code",
  permissionsAsk: "{name} asks to:",
  pluginCantInstall: "Can't: {reason}",
  pluginCheck: {
    dom: "Draws on the page.",
    permission: "Uses {permission}.",
    unregistered: "Declares {id}.",
    when: "Reads {key}.",
    runError: "Stopped: {error}",
    fix: "Fix with AI",
    fixRequest: "{name} has:\n{problems}",
  },
  permission: (p) => `may ${p}`,
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

it("lists each permission on a line of its own, in words", () => {
  const asking = reply.replace(
    '"permissions":[]',
    '"permissions":["editor.write","network:api.example.com"]',
  );
  const { container } = render(
    <SettingsProvider>
      <ReplyPlugins text={asking} labels={labels} />
    </SettingsProvider>,
  );
  expect(screen.getByText("Toggle asks to:")).toBeTruthy();
  const items = [...container.querySelectorAll(".agent-plugin-permissions li")];
  expect(items.map((li) => li.textContent)).toEqual([
    "may editor.write",
    "may network:api.example.com",
  ]);
});

it("shows the code Install would run, folded until asked", () => {
  const { container } = render(
    <SettingsProvider>
      <ReplyPlugins text={reply} labels={labels} />
    </SettingsProvider>,
  );
  expect(container.querySelector(".agent-reply-file")).toBeNull();
  const details = container.querySelector("details")!;
  details.open = true;
  fireEvent(details, new Event("toggle"));
  const paths = [...container.querySelectorAll(".agent-reply-file-path")];
  expect(paths.map((p) => p.textContent)).toEqual([
    "textus-plugin.json",
    "host.js",
  ]);
  expect(container.textContent).toContain("exports.activate");
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
