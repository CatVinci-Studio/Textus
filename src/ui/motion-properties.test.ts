import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Only opacity and transform move, and colours may change; anything that
// lays out or repaints each frame drops frames in WebKitGTK. Every stylesheet
// in src/ is read here; exceptions are listed with their reason.

const SRC = fileURLToPath(new URL("..", import.meta.url));

/** What may move or change, on its own. */
const ALLOWED = new Set([
  "opacity",
  "transform",
  "translate",
  "scale",
  "rotate",
  "color",
  "background",
  "background-color",
  "border-color",
  "outline-color",
  "text-decoration-color",
  "caret-color",
  "fill",
  "stroke",
  "stroke-dashoffset",
  // Switched at the end of a fade, never interpolated.
  "visibility",
  "offset",
]);

/** `file selector property`, and why. */
const EXCEPTIONS: Record<string, string> = {
  // A focus ring may change its shadow.
  "ai/chat/inline-chat.css :is(.agent-panel-body, .chat-window-body) .inline-chat-field box-shadow":
    "focus ring",
  // A small absolutely placed pill: its width lays out nothing else.
  "ai/chat/panel/agent-panel.css .agent-panel-tabs-thumb width":
    "segmented control",
  // A hairline in an SVG of its own: repaints that line only.
  "ai/margin/ReviewMargin.css .review-links path stroke-width":
    "connector under the pointer",
};

function stylesheets(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".css"))
    .map((file) => join(dir, file));
}

/** A comma list's items, commas inside parentheses left alone. */
function splitTop(list: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    if (list[i] === "(") depth++;
    else if (list[i] === ")") depth--;
    else if (list[i] === "," && depth === 0) {
      items.push(list.slice(start, i));
      start = i + 1;
    }
  }
  items.push(list.slice(start));
  return items.map((item) => item.trim()).filter(Boolean);
}

/** Every property a stylesheet animates: `selector property` pairs for
 *  transitions, `@keyframes name property` for keyframes. */
export function animatedProperties(css: string): string[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const found: string[] = [];
  // Keyframes first, cut out so their steps aren't read as rules.
  let rest = text;
  for (const match of text.matchAll(/@keyframes\s+([\w-]+)\s*\{/g)) {
    let depth = 1;
    let i = match.index + match[0].length;
    const from = i;
    for (; i < text.length && depth > 0; i++) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}") depth--;
    }
    const body = text.slice(from, i - 1);
    for (const prop of body.matchAll(/([a-z-]+)\s*:/g))
      found.push(`@keyframes ${match[1]} ${prop[1]}`);
    rest = rest.replace(text.slice(match.index, i), "");
  }
  for (const rule of rest.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = rule[1].trim().replace(/\s+/g, " ");
    for (const decl of rule[2].matchAll(
      /(?:^|;)\s*transition(-property)?\s*:\s*([^;]+)/g,
    ))
      for (const item of splitTop(decl[2])) {
        const prop = item.split(/\s+/)[0];
        if (prop === "none" || prop.startsWith("var(")) continue;
        found.push(`${selector} ${prop}`);
      }
  }
  return found;
}

describe("motion animates only opacity and transform", () => {
  it("reads a stylesheet's transitions and keyframes", () => {
    expect(
      animatedProperties(`
        .a { transition: opacity 1s, transform var(--d) cubic-bezier(0, 0, 1, 1); }
        .b { transition-property: width; }
        @keyframes k { from { opacity: 0; top: 2px } }
      `),
    ).toEqual([
      "@keyframes k opacity",
      "@keyframes k top",
      ".a opacity",
      ".a transform",
      ".b width",
    ]);
  });

  const files = stylesheets(SRC);
  it("finds the stylesheets", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  for (const file of files) {
    // Forward slashes on every platform, as EXCEPTIONS names them.
    const name = relative(SRC, file).split(sep).join("/");
    it(name, () => {
      const offending = animatedProperties(readFileSync(file, "utf8")).filter(
        (entry) => {
          const prop = entry.split(" ").at(-1)!;
          return !ALLOWED.has(prop) && !(`${name} ${entry}` in EXCEPTIONS);
        },
      );
      expect(offending).toEqual([]);
    });
  }
});
