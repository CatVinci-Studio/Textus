import { describe, expect, it } from "vitest";
import { helpDocContent } from "../document/doc-tabs";
import { LANGS } from "../i18n/strings";

const GUIDES = import.meta.glob<string>("./*-guide.*.md", {
  query: "?raw",
  import: "default",
  eager: true,
});

/** The heading levels in order, code blocks aside - a translated guide
 *  keeps the English one's sections, so neither drifts from the other. */
function outline(markdown: string): string[] {
  return [
    ...markdown
      .replace(/^```[^\n]*\n[\s\S]*?^```[ \t]*$/gm, "")
      .matchAll(/^(#{1,6}) /gm),
  ].map((m) => m[1]);
}

it("names only languages the app has", () => {
  for (const path of Object.keys(GUIDES)) {
    const lang = path.match(/^\.\/(?:markdown|agent)-guide\.(.+)\.md$/)?.[1];
    expect(LANGS, path).toContain(lang);
  }
});

describe.each(["markdown", "agent"] as const)("the %s guide", (doc) => {
  const english = GUIDES[`./${doc}-guide.en.md`];

  it("opens in every language, in English until it is translated", async () => {
    for (const lang of LANGS)
      expect(await helpDocContent(doc, lang)).toBe(
        GUIDES[`./${doc}-guide.${lang}.md`] ?? english,
      );
  });

  it("has the English guide's sections in every translation", () => {
    for (const lang of LANGS) {
      const guide = GUIDES[`./${doc}-guide.${lang}.md`];
      if (guide) expect(outline(guide), lang).toEqual(outline(english));
    }
  });
});
