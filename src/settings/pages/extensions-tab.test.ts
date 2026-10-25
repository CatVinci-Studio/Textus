import { describe, expect, it } from "vitest";
import { extensionsTabs } from "./extensions-tab";

describe("Settings › Extensions' tabs", () => {
  it("leave out Plugins where the app doesn't show plugins (a release)", () => {
    expect(extensionsTabs(false)).toEqual(["themes", "skills", "mcp"]);
  });

  it("put Plugins after Themes where it does (a development build)", () => {
    expect(extensionsTabs(true)).toEqual([
      "themes",
      "plugins",
      "skills",
      "mcp",
    ]);
  });
});
