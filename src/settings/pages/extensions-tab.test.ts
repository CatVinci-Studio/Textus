import { describe, expect, it, vi } from "vitest";
import { extensionsTabs } from "./extensions-tab";

const layout = vi.hoisted(() => ({ phone: false }));
vi.mock("../../platform/phone-layout", () => ({
  isPhoneLayout: () => layout.phone,
}));

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

describe("extensionsStartTab", () => {
  it("opens on the first tab of the layout in use now, not at load", async () => {
    vi.resetModules();
    layout.phone = true;
    const { extensionsStartTab } = await import("./extensions-tab");
    expect(extensionsStartTab()).toBe("plugins");
    layout.phone = false;
    expect(extensionsStartTab()).toBe("themes");
  });
});
