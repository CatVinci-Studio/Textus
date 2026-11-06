import { describe, expect, it } from "vitest";
import {
  collectNotes,
  compareVersions,
  notesLanguage,
  tidyNotes,
  versionOfPath,
} from "./changelog";
import { RELEASE_DATES } from "./release-dates";

/** The notes in a folder, by version. */
const read = (files: Record<string, string>) =>
  new Map(
    Object.entries(files).flatMap(([path, text]) => {
      const version = versionOfPath(path);
      return version ? [[version, text] as const] : [];
    }),
  );
const PUBLISHED = read(
  import.meta.glob<string>("../../../docs/releases/*.md", {
    query: "?raw",
    import: "default",
    eager: true,
  }),
);
const TRANSLATED = {
  en: read(
    import.meta.glob<string>("./notes/en/*.md", {
      query: "?raw",
      import: "default",
      eager: true,
    }),
  ),
  zh: read(
    import.meta.glob<string>("./notes/zh/*.md", {
      query: "?raw",
      import: "default",
      eager: true,
    }),
  ),
  "zh-Hant": read(
    import.meta.glob<string>("./notes/zh-Hant/*.md", {
      query: "?raw",
      import: "default",
      eager: true,
    }),
  ),
};

const isChinese = (text: string) => /[一-鿿]/.test(text.slice(0, 40));
const bullets = (text: string) =>
  tidyNotes(text)
    .split("\n")
    .filter((line) => /^\s*[-*] /.test(line)).length;

describe("versions", () => {
  it("orders patch numbers as numbers and a beta before its release", () => {
    const sorted = ["1.2.9", "1.3.0", "1.2.10", "1.3.0-beta.8", "1.3.0-beta.10"]
      .sort(compareVersions)
      .reverse();
    expect(sorted).toEqual([
      "1.3.0",
      "1.3.0-beta.10",
      "1.3.0-beta.8",
      "1.2.10",
      "1.2.9",
    ]);
  });

  it("reads a version from its notes' file name and skips the rest", () => {
    expect(versionOfPath("../docs/releases/1.3.0-beta.2.md")).toBe(
      "1.3.0-beta.2",
    );
    expect(versionOfPath("../docs/releases/TEMPLATE.md")).toBeNull();
  });

  it("gives Japanese and the other languages the English notes", () => {
    expect(notesLanguage("zh-Hant")).toBe("zh-Hant");
    expect(notesLanguage("ja")).toBe("en");
  });
});

describe("tidyNotes", () => {
  it("drops the heading and the line about installers below", () => {
    expect(
      tidyNotes(
        "## What's new\n\nOne line.\n\nInstallers for macOS (Apple silicon and Intel), Windows and Linux (x64 and ARM64) are below; the app updates itself.\n",
      ),
    ).toBe("One line.");
  });
});

describe("collectNotes", () => {
  it("puts a translation over the published notes, newest first", () => {
    const notes = collectNotes(
      [
        { "d/1.0.0.md": "## What's new\n\nOld", "d/1.1.0-beta.1.md": "Beta" },
        { "t/1.0.0.md": "## 更新内容\n\n旧" },
      ],
      { "1.0.0": "2026-10-16" },
    );
    expect(notes).toEqual([
      { version: "1.1.0-beta.1", prerelease: true, body: "Beta" },
      { version: "1.0.0", date: "2026-10-16", prerelease: false, body: "旧" },
    ]);
  });
});

describe("the bundled notes", () => {
  it("have a date for every published version", () => {
    for (const version of PUBLISHED.keys())
      expect(RELEASE_DATES[version], version).toMatch(/^\d{4}-\d\d-\d\d$/);
  });

  it("are in English and in Chinese for every version", () => {
    for (const [version, text] of PUBLISHED) {
      const translated = isChinese(text) ? "en" : "zh";
      expect(TRANSLATED[translated].has(version), version).toBe(true);
      expect(TRANSLATED["zh-Hant"].has(version), version).toBe(true);
    }
  });

  it("translate a version that was published, bullet for bullet", () => {
    for (const translations of Object.values(TRANSLATED))
      for (const [version, text] of translations) {
        const published = PUBLISHED.get(version);
        expect(published, `${version} was published`).toBeDefined();
        expect(bullets(text), version).toBe(bullets(published!));
      }
  });
});
