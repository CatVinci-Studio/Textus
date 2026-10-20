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

  it("updates from the stable channel unless beta was chosen", () => {
    expect(loadSettings().updateChannel).toBe("stable");
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ language: "zh" }));
    expect(loadSettings().updateChannel).toBe("stable");
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ language: "zh", updateChannel: "beta" }),
    );
    expect(loadSettings().updateChannel).toBe("beta");
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ language: "zh", updateChannel: "nightly" }),
    );
    expect(loadSettings().updateChannel).toBe("stable");
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

describe("settings from a build with features since taken out", () => {
  beforeAll(installTestLocalStorage);
  beforeEach(() => localStorage.clear());

  it("load as before, the old fields doing nothing", () => {
    // 1.2.0-rc.1's Quick Notes and open-at-login fields.
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        language: "zh",
        runInBackground: true,
        openAtLogin: true,
        quickNoteShortcutEnabled: true,
        quickNoteShortcut: "Control+Alt+N",
        quickNoteFolder: "/home/me/Documents/Textus/速记",
        quickNotePerDay: true,
        quickNoteContinueMinutes: 5,
      }),
    );
    const settings = loadSettings();
    expect(settings.language).toBe("zh");
    expect(settings.runInBackground).toBe(true);
  });
});

describe("Agent mode migration", () => {
  beforeAll(installTestLocalStorage);
  beforeEach(() => localStorage.clear());

  it("starts new conversations in Review mode", () => {
    expect(loadSettings().agentDefaultMode).toBe("review");
  });

  it("reads 1.0's mode names as today's, and Plan as Review", () => {
    for (const [saved, mode] of [
      ["ask", "review"],
      ["edit", "revise"],
      ["plan", "review"],
      ["write", "write"],
    ]) {
      localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify({ agentDefaultMode: saved }),
      );
      expect(loadSettings().agentDefaultMode).toBe(mode);
    }
  });

  it("rejects an unknown saved mode", () => {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ agentDefaultMode: "destroy" }),
    );
    expect(loadSettings().agentDefaultMode).toBe("review");
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

describe("where images go", () => {
  beforeAll(installTestLocalStorage);
  beforeEach(() => localStorage.clear());

  it("saves images in assets/ and offers PicGo for uploads", () => {
    const settings = loadSettings();
    expect(settings.imageFolder).toBe("assets");
    expect(settings.imageHost).toBe("picgo");
  });

  it("moves an image folder from before the two choices onto one of them", () => {
    const folderOf = (imageFolder: string) => {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ imageFolder }));
      return loadSettings().imageFolder;
    };
    expect(folderOf("./")).toBe("./");
    expect(folderOf("${filename}.assets")).toBe("assets");
    expect(folderOf("pictures")).toBe("pictures");
    expect(folderOf("../shared/images")).toBe("assets");
  });

  it("keeps an endpoint set up before the presets as the custom host", () => {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        imageStorageMode: "image-host",
        imageUploadEndpoint: "https://images.example.com/upload",
      }),
    );
    expect(loadSettings().imageHost).toBe("custom");
  });
});
