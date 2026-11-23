import { describe, expect, it } from "vitest";
import { extensionsTabs } from "./extensions-tab";

describe("extensionsTabs", () => {
  it("lists every tab where the app runs programs and has Textus AI", () => {
    expect(extensionsTabs(true, true)).toEqual([
      "themes",
      "plugins",
      "skills",
      "mcp",
      "create",
    ]);
  });

  it("shows no AI tab (Skills, Create) where there is no Textus AI - iOS", () => {
    expect(extensionsTabs(false, false)).toEqual(["themes", "plugins"]);
  });
});
