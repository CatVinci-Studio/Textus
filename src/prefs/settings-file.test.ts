import { describe, expect, it } from "vitest";
import { settingsFileText, settingsFromFile } from "./settings-file";
import { DEFAULT_SETTINGS, type Settings } from "./settings-types";

const server = {
  id: "gh",
  name: "GitHub",
  enabled: true,
  command: "npx",
  args: ["github-mcp"],
  env: { GITHUB_TOKEN: "secret-token" },
  url: "",
  headers: {},
};

const mine: Settings = {
  ...DEFAULT_SETTINGS,
  language: "en",
  agentWorkspaceRoot: "/Users/me/Notes",
  mcpServers: [server],
};

describe("the settings file", () => {
  it("leaves MCP tokens out", () => {
    const text = settingsFileText(mine);
    expect(text).not.toContain("secret-token");
    expect(JSON.parse(text).settings.mcpServers[0].env).toEqual({
      GITHUB_TOKEN: "",
    });
  });

  it("comes back as it went, this computer's tokens and folders kept", () => {
    const other: Settings = {
      ...mine,
      language: "de",
      agentWorkspaceRoot: "/home/other/Notes",
    };
    const imported = settingsFromFile(settingsFileText(other), mine);
    expect(imported?.language).toBe("de");
    expect(imported?.agentWorkspaceRoot).toBe("/Users/me/Notes");
    expect(imported?.mcpServers[0].env).toEqual({
      GITHUB_TOKEN: "secret-token",
    });
  });

  it("is refused when it isn't Textus settings", () => {
    expect(settingsFromFile("{}", mine)).toBeNull();
    expect(settingsFromFile("not json", mine)).toBeNull();
    expect(settingsFromFile('{"language":"de"}', mine)).toBeNull();
  });
});
