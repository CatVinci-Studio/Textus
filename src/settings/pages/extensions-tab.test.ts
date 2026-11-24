import { describe, expect, it } from "vitest";
import { extensionsTabs } from "./extensions-tab";

describe("extensionsTabs", () => {
  it("lists every tab where the app runs programs and has Textus AI", () => {
    expect(extensionsTabs({ mcp: true, ai: true, phone: false })).toEqual([
      "themes",
      "plugins",
      "skills",
      "mcp",
      "create",
    ]);
  });

  it("shows no AI tab (Skills, Create) where there is no Textus AI - iOS", () => {
    expect(extensionsTabs({ mcp: false, ai: false, phone: false })).toEqual([
      "themes",
      "plugins",
    ]);
  });

  it("leaves a phone's themes to Appearance and its skills to Memory & Skills", () => {
    expect(extensionsTabs({ mcp: false, ai: true, phone: true })).toEqual([
      "plugins",
      "create",
    ]);
    expect(extensionsTabs({ mcp: false, ai: false, phone: true })).toEqual([
      "plugins",
    ]);
  });
});
