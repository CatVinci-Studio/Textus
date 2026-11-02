import { describe, expect, it } from "vitest";
import { extensionsTabs } from "./extensions-tab";

describe("Settings › Extensions' tabs", () => {
  it("leave out Plugins where the app doesn't show plugins (a release)", () => {
    expect(extensionsTabs(false)).toEqual([
      "themes",
      "skills",
      "mcp",
      "create",
    ]);
  });

  it("put Plugins after Themes where it does (a development build)", () => {
    expect(extensionsTabs(true)).toEqual([
      "themes",
      "plugins",
      "skills",
      "mcp",
      "create",
    ]);
  });

  it("keep Create last, where nothing installed sits after it", () => {
    expect(extensionsTabs(true, false).slice(-1)).toEqual(["create"]);
  });
});
