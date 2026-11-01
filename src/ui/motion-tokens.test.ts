import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Timing comes from motion.css's tokens and movement from its shared moves,
// so one change there reaches everything and reduced motion reaches it too.

const SRC = fileURLToPath(new URL("..", import.meta.url));

/** Keyframes of their own, and why the shared moves don't cover them. */
const OWN_KEYFRAMES: Record<string, string> = {
  // "Working" loops.
  "ui/notices.css notice-indeterminate": "progress sweep",
  "ai/chat/inline-chat.css agent-thinking-pulse": "thinking dots",
  "ai/chat/inline-chat.css agent-caret-pulse": "caret while writing",
  "editor/milkdown-theme.css ghost-caret-blink": "caret before a suggestion",
  "ai/revision/pending-picture.css pending-picture-drift": "picture being made",
  "ai/revision/pending-picture.css pending-picture-sheen": "picture being made",
  "export/print.css pdf-export-spin": "export spinner",
  "ai/paper/outline-card.css paper-spin": "paper being written",
  "ai/paper/outline-card.css paper-breathe": "paper's part being worked on",
  // A state shown by colour or a stroke, not a part arriving.
  "settings/SettingsPanel.css settings-search-hit": "tint fading as read",
  "app/modes.css zen-hint-dim": "hint stepping back",
  "ai/margin/ReviewMargin.css review-link-draw": "connector drawn",
  "editor/milkdown-theme.css pending-strike-in": "strike arriving",
  "editor/milkdown-theme.css pending-landed": "tint after landing",
  "editor/milkdown-theme.css pending-fade-kept": "kept text settling",
  // A plugin's webview has no motion.css: its own copies of the moves.
  "plugins/host/runtime/plugin-ui.css motion-enter": "plugin webview",
  "plugins/host/runtime/plugin-ui.css motion-exit": "plugin webview",
};

/** A time written out: 200ms, 1.2s. Zero and 1ms (a step, not a motion)
 *  are not timing. */
const RAW_TIME = /(?<![\w-])(?!0m?s\b|1ms\b)\d*\.?\d+m?s\b/;

function stylesheets(): string[] {
  return readdirSync(SRC, { recursive: true, encoding: "utf8" })
    .filter(
      (file) => file.endsWith(".css") && file !== join("ui", "motion.css"),
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
      const rawTimes = [
        ...css.matchAll(/(?:animation|transition)[\w-]*\s*:\s*([^;}]+)/g),
      ]
        .map((m) => m[0].trim())
        .filter((decl) => RAW_TIME.test(withoutFallbacks(decl)));
      const keyframes = [...css.matchAll(/@keyframes\s+([\w-]+)/g)]
        .map((m) => `${name} ${m[1]}`)
        .filter((entry) => !(entry in OWN_KEYFRAMES));
      expect({ rawTimes, keyframes }).toEqual({ rawTimes: [], keyframes: [] });
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
