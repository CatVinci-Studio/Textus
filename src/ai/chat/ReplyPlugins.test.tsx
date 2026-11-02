// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ReplyPlugins, type ReplyPluginLabels } from "./ReplyPlugins";
import { askAi } from "./ask-ai";

vi.mock("./ask-ai", () => ({ askAi: vi.fn() }));
vi.mock("../../plugins/manager", () => {
  const none = { loaded: true, allOn: true, records: [] };
  return {
    installPlugin: vi.fn(),
    setPluginEnabled: vi.fn(),
    pluginsSnapshot: () => none,
    subscribePlugins: () => () => {},
  };
});

afterEach(cleanup);

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
  render(<ReplyPlugins text={reply} labels={labels} />);
  expect(screen.getByText("Draws on the page.")).toBeTruthy();
  fireEvent.click(screen.getByText("Fix with AI"));
  expect(askAi).toHaveBeenCalledWith(
    "Toggle (local.toggle) has:\n- Draws on the page.",
    "create",
  );
});
