import { describe, expect, it } from "vitest";
import { settingsSummary } from "./report";
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
