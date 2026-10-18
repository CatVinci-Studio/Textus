// @vitest-environment jsdom

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadSettings } from "./SettingsContext";
import { installTestLocalStorage } from "../dev/test-local-storage";

const SETTINGS_KEY = "catvinci-settings";

describe("newcomer guide eligibility", () => {
  beforeAll(installTestLocalStorage);
  beforeEach(() => localStorage.clear());

  it("marks a brand-new installation as needing onboarding", () => {
    const settings = loadSettings();
    expect(settings.onboardingShown).toBe(false);
    expect(settings.languageChosen).toBe(false);
    expect(settings.autoSuggestFilename).toBe(true);
  });

  it("exports PDFs without page numbers until they are switched on", () => {
    expect(loadSettings().pdfPageNumbers).toBe(false);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ language: "zh" }));
    expect(loadSettings().pdfPageNumbers).toBe(false);
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ language: "zh", pdfPageNumbers: true }),
    );
    expect(loadSettings().pdfPageNumbers).toBe(true);
  });

  it("does not surprise installations whose old settings predate the flag", () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ language: "zh" }));
    expect(loadSettings().onboardingShown).toBe(true);
    expect(loadSettings().languageChosen).toBe(true);
  });

  it("preserves a deferred first-use guide until it is actually shown", () => {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ language: "zh", onboardingShown: false }),
    );
    expect(loadSettings().onboardingShown).toBe(false);
  });
});

describe("Agent mode migration", () => {
  beforeAll(installTestLocalStorage);
  beforeEach(() => localStorage.clear());

  it("starts new conversations in Ask mode", () => {
    expect(loadSettings().agentDefaultMode).toBe("ask");
  });

  it("rejects an unknown saved mode", () => {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ agentDefaultMode: "destroy" }),
    );
    expect(loadSettings().agentDefaultMode).toBe("ask");
  });
});

describe("separate writing and Agent models", () => {
  beforeAll(installTestLocalStorage);
  beforeEach(() => localStorage.clear());

  it("starts both per-provider model maps empty so each backend default applies", () => {
    const settings = loadSettings();
    expect(settings.writingModels).toEqual({});
    expect(settings.agentModels).toEqual({});
  });

  it("preserves writing and Agent choices independently", () => {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        writingModels: { openai: "gpt-5.4-nano" },
        agentModels: { openai: "gpt-5.6" },
      }),
    );
    const settings = loadSettings();
    expect(settings.writingModels.openai).toBe("gpt-5.4-nano");
    expect(settings.agentModels.openai).toBe("gpt-5.6");
  });
});

describe("appearance and theme are independent", () => {
  beforeAll(installTestLocalStorage);
  beforeEach(() => localStorage.clear());

  it("follows the system until told otherwise", () => {
    expect(loadSettings().theme).toBe("system");
  });

  it("keeps a pinned appearance", () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ theme: "dark" }));
    expect(loadSettings().theme).toBe("dark");
  });

  it("keeps the two axes independent", () => {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ theme: "dark", themeId: "paper" }),
    );
    const settings = loadSettings();
    expect(settings.theme).toBe("dark");
    expect(settings.themeId).toBe("paper");
  });

  it("falls back to system for an appearance it does not recognise", () => {
    // A value written by a future (or corrupted) build must not become a
    // `data-theme` nothing has styles for.
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ theme: "sepia", themeId: "paper", zoom: 1.25 }),
    );
    const settings = loadSettings();
    expect(settings.theme).toBe("system");
    // ...and the rest of the blob survives that rejection.
    expect(settings.themeId).toBe("paper");
    expect(settings.zoom).toBe(1.25);
  });
});
