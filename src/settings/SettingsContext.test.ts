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

  it("keeps the guide and the welcome due while the settings don't say otherwise", () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ language: "zh" }));
    expect(loadSettings().onboardingShown).toBe(false);
    expect(loadSettings().languageChosen).toBe(false);
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ onboardingShown: "yes", languageChosen: true }),
    );
    expect(loadSettings().onboardingShown).toBe(false);
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

  it("read 1.2.0's changes-in-the-text view as Result only, its originals in the margin", () => {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ language: "zh", revisionDisplay: "new" }),
    );
    expect(loadSettings().revisionDisplay).toBe("final");
  });
});

describe("colour swatches", () => {
  beforeAll(installTestLocalStorage);
  beforeEach(() => localStorage.clear());

  const load = (stored: Record<string, unknown>) => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(stored));
    return loadSettings().colorSwatches;
  };

  it("are off by default", () => {
    expect(load({ language: "en" })).toBe("off");
  });

  it("keep a choice, and drop one they don't know", () => {
    expect(load({ colorSwatches: "everywhere" })).toBe("everywhere");
    expect(load({ colorSwatches: "code" })).toBe("code");
    expect(load({ colorSwatches: "sometimes" })).toBe("off");
    expect(load({ colorSwatches: true })).toBe("off");
  });
});

describe("the default Agent mode", () => {
  beforeAll(installTestLocalStorage);
  beforeEach(() => localStorage.clear());

  it("starts new conversations in Review mode", () => {
    expect(loadSettings().agentDefaultMode).toBe("review");
  });

  it("keeps a saved mode", () => {
    for (const mode of ["write", "review"]) {
      localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify({ agentDefaultMode: mode }),
      );
      expect(loadSettings().agentDefaultMode).toBe(mode);
    }
  });

  it("reads 1.2.0's Revise mode as Write", () => {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ agentDefaultMode: "revise" }),
    );
    expect(loadSettings().agentDefaultMode).toBe("write");
  });

  it("rejects a mode it doesn't know", () => {
    for (const saved of ["destroy", "ask", 3]) {
      localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify({ agentDefaultMode: saved }),
      );
      expect(loadSettings().agentDefaultMode).toBe("review");
    }
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

  it("keeps only the string entries of a stored map", () => {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        writingModels: ["gpt-5.4-nano"],
        agentModels: { openai: "gpt-5.6", anthropic: 4 },
        theme: "dark",
      }),
    );
    const settings = loadSettings();
    expect(settings.writingModels).toEqual({});
    expect(settings.agentModels).toEqual({ openai: "gpt-5.6" });
    expect(settings.theme).toBe("dark");
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

  it("keeps an image folder that is one of the two choices", () => {
    const folderOf = (imageFolder: string) => {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ imageFolder }));
      return loadSettings().imageFolder;
    };
    expect(folderOf("./")).toBe("./");
    expect(folderOf("${filename}.assets")).toBe("assets");
    expect(folderOf("pictures")).toBe("pictures");
    expect(folderOf("../shared/images")).toBe("assets");
  });

  it("falls back to PicGo for an image host it doesn't know", () => {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        imageHost: "flickr",
        imageUploadEndpoint: "https://images.example.com/upload",
      }),
    );
    const settings = loadSettings();
    expect(settings.imageHost).toBe("picgo");
    expect(settings.imageUploadEndpoint).toBe(
      "https://images.example.com/upload",
    );
  });
});
