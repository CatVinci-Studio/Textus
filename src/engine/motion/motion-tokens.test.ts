import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Timing comes from motion.css's tokens and movement from its shared moves,
// so one change there reaches everything and reduced motion reaches it too.

const SRC = fileURLToPath(new URL("../..", import.meta.url));

/** Keyframes of their own, and why the shared moves don't cover them. */
const OWN_KEYFRAMES: Record<string, string> = {
  // "Working" loops.
  "ai/chat/chat-progress.css agent-thinking-pulse": "thinking dots",
  "ai/chat/chat-progress.css agent-caret-pulse": "caret while writing",
  "editor/editor-base.css ghost-caret-blink": "caret before a suggestion",
  // Two names, so each move starts the blink over.
  "editor/drawn-caret.css drawn-caret-blink-a": "the caret",
  "editor/drawn-caret.css drawn-caret-blink-b": "the caret",
  "ai/revision/pending-picture.css pending-picture-drift": "picture being made",
  "ai/revision/pending-picture.css pending-picture-sheen": "picture being made",
  // A state shown by colour or a stroke, not a part arriving.
  "settings/settings-frame.css settings-search-hit": "tint fading as read",
  "ai/margin/margin-cards.css review-link-draw": "connector drawn",
  "editor/editor-pending.css pending-strike-in": "strike arriving",
  "editor/editor-pending.css pending-landed": "tint after landing",
  "editor/editor-pending.css pending-fade-kept": "kept text settling",
};

/** A time written out: 200ms, 1.2s. Zero and 1ms (a step, not a motion)
 *  are not timing. */
const RAW_TIME = /(?<![\w-])(?!0m?s\b|1ms\b)\d*\.?\d+m?s\b/;
/** An easing written out: a keyword or a curve of its own. steps() is a
 *  blink's on and off, not a curve. */
const RAW_EASING =
  /(?<![\w-])(?:linear|ease(?:-in|-out|-in-out)?|cubic-bezier\()(?![\w-])/;

function stylesheets(): string[] {
  return readdirSync(SRC, { recursive: true, encoding: "utf8" })
    .filter(
      (file) =>
        file.endsWith(".css") &&
        !file.startsWith(join("engine", "motion", "motion")),
    )
    .map((file) => relative(SRC, join(SRC, file)).split(sep).join("/"));
}

/** A declaration's value with var() fallbacks taken out. */
function withoutFallbacks(value: string): string {
  return value.replace(/var\(\s*--[\w-]+\s*,[^()]*(\([^()]*\))?[^()]*\)/g, "");
}

describe("motion tokens", () => {
  const files = stylesheets();
  it("finds the stylesheets", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  for (const name of files) {
    const css = readFileSync(join(SRC, name), "utf8").replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    );
    it(name, () => {
      const timing = [
        ...css.matchAll(/(?:animation|transition)[\w-]*\s*:\s*([^;}]+)/g),
      ].map((m) => m[0].trim());
      const rawTimes = timing.filter((decl) =>
        RAW_TIME.test(withoutFallbacks(decl)),
      );
      // A 0s item is a switch (visibility at a fade's end): no curve.
      const rawEasings = timing.filter((decl) =>
        withoutFallbacks(decl)
          .split(/,(?![^(]*\))/)
          .some((item) => !/\s0s\b/.test(item) && RAW_EASING.test(item)),
      );
      const keyframes = [...css.matchAll(/@keyframes\s+([\w-]+)/g)]
        .map((m) => `${name} ${m[1]}`)
        .filter((entry) => !(entry in OWN_KEYFRAMES));
      expect({ rawTimes, rawEasings, keyframes }).toEqual({
        rawTimes: [],
        rawEasings: [],
        keyframes: [],
      });
    });
  }

  it("lists no keyframes that are gone", () => {
    const declared = new Set(
      files.flatMap((name) =>
        [
          ...readFileSync(join(SRC, name), "utf8").matchAll(
            /@keyframes\s+([\w-]+)/g,
          ),
        ].map((m) => `${name} ${m[1]}`),
      ),
    );
    expect(Object.keys(OWN_KEYFRAMES).filter((k) => !declared.has(k))).toEqual(
      [],
    );
  });
});
