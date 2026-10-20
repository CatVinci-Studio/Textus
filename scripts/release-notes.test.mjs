import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assemble,
  fragmentProblems,
  parseFragment,
  SUMMARY_PLACEHOLDER,
  unreleasedProblems,
} from "./release-notes.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("release-note fragments", () => {
  it("every fragment in this checkout follows the format", () => {
    expect(fragmentProblems(root)).toEqual([]);
  });

  it("reads each section's bullets, with their continuation lines", () => {
    const { sections, problems } = parseFragment(
      "### Fixed\n\n- Keeps one.\n- Keeps two,\n  over two lines. (#2)\n\n### Platform notes\n\n- **Linux:** Works.\n",
    );
    expect(problems).toEqual([]);
    expect(sections).toEqual({
      Fixed: ["- Keeps one.", "- Keeps two,\n  over two lines. (#2)"],
      "Platform notes": ["- **Linux:** Works."],
    });
  });

  it("refuses headings the template doesn't have, prose and empty fragments", () => {
    expect(parseFragment("### Changed\n\n- Something.\n").problems).toEqual([
      expect.stringContaining('"### Changed" is not one of'),
    ]);
    expect(parseFragment("## Fixed\n\n- Something.\n").problems).toEqual([
      expect.stringContaining('"## Fixed" is not one of'),
    ]);
    expect(parseFragment("### Fixed\n\nSome prose.\n").problems).toContain(
      'line 3: only section headings and "- " bullets belong here',
    );
    expect(parseFragment("- Before any heading.\n").problems).toContain(
      "line 1: a bullet before any section heading",
    );
    expect(parseFragment("").problems).toEqual(["no bullets"]);
  });
});

describe("assembling release notes", () => {
  const fragment = (text) => parseFragment(text);

  it("leaves every existing release's notes as they are when there is nothing to add", () => {
    const dir = join(root, "docs/releases");
    for (const name of readdirSync(dir).filter((n) => /^\d.*\.md$/.test(n))) {
      const notes = readFileSync(join(dir, name), "utf8");
      // Older notes have prose between sections; only template-shaped ones
      // round-trip, and those are the ones build ever edits.
      if (!/^## What's new/.test(notes)) continue;
      expect(assemble({ version: name, notes, fragments: [] }), name).toBe(
        notes,
      );
    }
  });

  it("adds bullets at the end of their sections and new sections in the template's order", () => {
    const notes =
      "## What's new\n\nTextus 9.9.0 fixes things.\n\n### Fixed\n\n- Old fix. (#1)\n\nInstallers are below.\n";
    const out = assemble({
      version: "9.9.0",
      notes,
      fragments: [
        fragment("### Fixed\n\n- New fix. (#3)\n"),
        fragment("### New\n\n- Adds a thing. (#2)\n"),
      ],
    });
    expect(out).toBe(
      "## What's new\n\nTextus 9.9.0 fixes things.\n\n### New\n\n- Adds a thing. (#2)\n\n### Fixed\n\n- Old fix. (#1)\n- New fix. (#3)\n\nInstallers are below.\n",
    );
  });

  it("keeps platform notes in the template's order of platforms", () => {
    const out = assemble({
      version: "9.9.0",
      notes: undefined,
      fragments: [
        fragment("### Platform notes\n\n- **Linux:** One.\n"),
        fragment("### Platform notes\n\n- **macOS:** Two.\n"),
        fragment("### Platform notes\n\n- **Linux:** Three.\n"),
      ],
    });
    expect(out).toContain(
      "### Platform notes\n\n- **macOS:** Two.\n- **Linux:** One.\n- **Linux:** Three.\n",
    );
  });

  it("starts a new release's notes from the template's outline, summary still to write", () => {
    const out = assemble({
      version: "9.9.0",
      notes: undefined,
      fragments: [fragment("### Improved\n\n- Opens faster. (#4)\n")],
    });
    expect(out).toBe(
      `## What's new\n\nTextus 9.9.0 ${SUMMARY_PLACEHOLDER}.\n\n### Improved\n\n- Opens faster. (#4)\n\nInstallers for macOS (Apple silicon and Intel), Windows and Linux (x64 and ARM64) are below; the app updates itself.\n`,
    );
  });
});

describe("tagging a stable release", () => {
  it("is refused while fragments are left or the summary is unwritten", () => {
    const dir = mkdtempSync(join(tmpdir(), "release-notes-"));
    mkdirSync(join(dir, "docs/releases/next"), { recursive: true });
    writeFileSync(join(dir, "docs/releases/next/README.md"), "# Fragments\n");
    writeFileSync(join(dir, "docs/releases/9.9.0.md"), "Textus 9.9.0 fixes.\n");
    expect(unreleasedProblems(dir, "9.9.0")).toEqual([]);

    writeFileSync(
      join(dir, "docs/releases/next/fix.md"),
      "### Fixed\n\n- Fixes. (#1)\n",
    );
    writeFileSync(
      join(dir, "docs/releases/9.9.0.md"),
      `Textus 9.9.0 ${SUMMARY_PLACEHOLDER}.\n`,
    );
    expect(unreleasedProblems(dir, "9.9.0")).toEqual([
      expect.stringContaining("1 release-note fragment(s)"),
      "docs/releases/9.9.0.md still needs its summary sentence",
    ]);
  });
});
