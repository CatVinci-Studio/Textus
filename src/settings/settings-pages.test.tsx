import { describe, expect, it } from "vitest";
import { resolveStrings } from "../i18n/strings";
import {
  registerSettingsPage,
  settingsPage,
  settingsPages,
} from "./settings-pages";

describe("the Settings pages", () => {
  it("are the built-in ones in navigation order", () => {
    const t = resolveStrings("en");
    expect(settingsPages().map((p) => p.label(t))).toEqual([
      "General",
      "Editor & Appearance",
      "Textus AI",
      "Extensions",
      "Shortcuts",
      "Privacy",
    ]);
  });

  it("take one more after them, and give it back", () => {
    const remove = registerSettingsPage({
      id: "example",
      label: () => "Example",
      Page: () => null,
    });
    expect(settingsPages().at(-1)?.id).toBe("example");
    expect(settingsPage("example")?.label(resolveStrings("en"))).toBe(
      "Example",
    );
    // An id already taken is refused.
    expect(() =>
      registerSettingsPage({ id: "ai", label: () => "AI", Page: () => null }),
    ).toThrow(/already registered/);
    remove();
    expect(settingsPage("example")).toBeUndefined();
  });

  it("leave out one this platform doesn't show", () => {
    const remove = registerSettingsPage({
      id: "hidden",
      label: () => "Hidden",
      available: () => false,
      Page: () => null,
    });
    expect(settingsPage("hidden")).toBeUndefined();
    remove();
  });
});
