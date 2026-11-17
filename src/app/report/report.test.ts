// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { reportDetails, settingsSummary } from "./report";
import { watchInput } from "./input-trail";
import type { Settings } from "../../prefs/settings-types";

describe("settingsSummary", () => {
  it("keeps switches, numbers and short choices, never places or the user's words", () => {
    const summary = settingsSummary({
      autosave: true,
      zoom: 1.1,
      theme: "dark",
      aiProvider: "deepseek",
      imageFolder: "/Users/me/Pictures",
      searxngUrl: "https://search.example.com",
      proxyHost: "10.0.0.2",
      proxyPort: "7890",
      proxyUsername: "me",
      proxyPassword: "hunter2",
      customCss: "body { color: red }",
      writingConventions: "Use British spelling",
      agentWorkspaceRoot: "/Users/me/work",
      writingModels: { deepseek: "deepseek-chat" },
      mcpServers: [{}, {}],
      imageModel: "a model name with spaces in it",
    } as unknown as Settings);
    expect(summary).toBe(
      "autosave=true, zoom=1.1, theme=dark, aiProvider=deepseek, mcpServers=[2]",
    );
  });
});

describe("reportDetails", () => {
  const facts = {
    os: "windows",
    arch: "x86_64",
    webview: "142",
    language: "zh",
  };
  const imeKeys = () => {
    for (let i = 0; i < 5; i++)
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Process" }));
  };

  it("tells input-method keys that never composed from ones that did", () => {
    watchInput();
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new CompositionEvent("compositionstart"));
    imeKeys();
    expect(reportDetails(facts)).not.toContain("no composition");
    window.dispatchEvent(new Event("blur"));
    window.dispatchEvent(new Event("focus"));
    imeKeys();
    const lines = reportDetails(facts).split("\n");
    const trail = lines.slice(lines.indexOf("Focus and input:") + 1);
    expect(trail.map((l) => l.slice(9))).toEqual([
      "window focused",
      "window left",
      "window focused",
      "input method keys with no composition (in body)",
    ]);
  });
});
