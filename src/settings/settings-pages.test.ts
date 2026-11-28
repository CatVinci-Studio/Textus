import { describe, expect, it, vi } from "vitest";
import en from "../i18n/locales/en";

// Textus AI is there and the device is a desktop: every page is listed.
vi.mock("../platform/capabilities", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  hasTextusAi: true,
  isMobileApp: false,
  canExportPdf: true,
  canExportWithPandoc: true,
}));
vi.mock("../platform/phone-layout", () => ({ isPhoneLayout: () => false }));

const { settingsPage, settingsPages } = await import("./settings-pages");

describe("settings pages", () => {
  it("lists Memory & projects and Skills as two pages, in that order, under Textus AI", () => {
    const ai = settingsPages().filter((p) => p.group === "ai");
    expect(ai.map((p) => p.id)).toEqual([
      "providers",
      "chat",
      "memory",
      "skills",
      "mcp",
    ]);
    expect(settingsPage("memory")?.label(en)).toBe("Memory & projects");
    expect(settingsPage("skills")?.label(en)).toBe("Skills");
  });

  it("has a name for every page in every language", async () => {
    const { LANGS, loadLocale, resolveStrings } =
      await import("../i18n/strings");
    for (const lang of LANGS) {
      await loadLocale(lang);
      for (const page of settingsPages())
        expect(
          page.label(resolveStrings(lang)),
          `${lang} ${page.id}`,
        ).toBeTruthy();
    }
  });
});
