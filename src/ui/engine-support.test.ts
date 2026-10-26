import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import postcss, { type AtRule, type Node } from "postcss";
import { describe, expect, it } from "vitest";

// The oldest supported engine is WebView2 on Chromium 105. The e2e flows run
// a current Chromium, which can't show what an old one drops, so the sources
// are read here. Newer features are fine inside a matching @supports with a
// fallback; color-mix() needs no guard, as the build lowers it.

const SRC = join(__dirname, "..");
const SKIPPED = ["mobile", "playground"];

/** Newer than Chromium 105, with the version that brought each in. */
const CSS_FEATURES: { name: string; since: number; pattern: RegExp }[] = [
  {
    name: "dynamic, small and large viewport units (dvh, svh, lvh, ...)",
    since: 108,
    pattern: /\d(d|s|l)v(h|w|i|b|min|max)\b/,
  },
  {
    name: "round(), mod(), rem()",
    since: 125,
    pattern: /(?<![-\w])(round|mod|rem)\(/,
  },
  {
    name: "oklch(), oklab(), lab(), lch(), color()",
    since: 111,
    pattern: /(?<![-\w])(oklch|oklab|lab|lch|color)\(/,
  },
  {
    name: "relative colours (rgb(from ...))",
    since: 119,
    pattern: /(?<![-\w])(rgba?|hsla?|hwb|oklch|oklab|lab|lch)\(\s*from\s/,
  },
  { name: "light-dark()", since: 123, pattern: /(?<![-\w])light-dark\(/ },
  { name: "linear() easing", since: 113, pattern: /(?<![-\w])linear\(/ },
  {
    name: "trigonometric and exponential functions",
    since: 111,
    pattern:
      /(?<![-\w])(sin|cos|tan|asin|acos|atan|atan2|pow|sqrt|hypot|log|exp|abs|sign)\(/,
  },
  {
    name: "anchor positioning",
    since: 125,
    pattern:
      /(?<![-\w])(anchor-name|position-anchor|position-area|position-try)\b|(?<![-\w])anchor(-size)?\(/,
  },
  { name: "field-sizing", since: 123, pattern: /(?<![-\w])field-sizing\b/ },
  {
    name: "interpolate-size, calc-size()",
    since: 129,
    pattern: /(?<![-\w])(interpolate-size\b|calc-size\()/,
  },
  {
    name: "text-box",
    since: 133,
    pattern: /(?<![-\w])text-box(-trim|-edge)?\s*:/,
  },
  {
    name: "view transitions",
    since: 111,
    pattern: /(?<![-\w])view-transition-(name|class)\b|::view-transition/,
  },
  {
    name: ":user-valid, :user-invalid, :open, :popover-open, :state(), ::details-content",
    since: 119,
    pattern:
      /:(user-valid|user-invalid|open|popover-open|state\()|::details-content/,
  },
];

/** At-rules newer than Chromium 105. */
const AT_RULES: {
  name: string;
  since: number;
  test: (rule: AtRule) => boolean;
}[] = [
  {
    name: "@starting-style",
    since: 117,
    test: (r) => r.name === "starting-style",
  },
  { name: "@scope", since: 118, test: (r) => r.name === "scope" },
  {
    name: "@view-transition",
    since: 126,
    test: (r) => r.name === "view-transition",
  },
  { name: "@position-try", since: 125, test: (r) => r.name === "position-try" },
  {
    name: "@container style() and scroll-state() queries",
    since: 111,
    test: (r) =>
      r.name === "container" && /\b(style|scroll-state)\(/.test(r.params),
  },
];

/** What is most likely written in an inline style or a style string in the
 *  code, which the build doesn't lower (color-mix() included). */
const SCRIPT_CSS: { name: string; since: number; pattern: RegExp }[] = [
  { name: "color-mix()", since: 111, pattern: /color-mix\(/ },
  { name: "dvh, svh, lvh", since: 108, pattern: /\d(d|s|l)v(h|w)\b/ },
  { name: "oklch(), oklab()", since: 111, pattern: /\bok(lch|lab)\(/ },
  { name: "light-dark()", since: 123, pattern: /\blight-dark\(/ },
];
/** File -> what may stay there, and why. */
const SCRIPT_ALLOWED: Record<string, string> = {
  // The located block's accent flash: an old engine skips the frame, and
  // the block is found without it.
  "editor/reveal-position.ts": "color-mix()",
  // Recognises colour codes written in the document; styles nothing.
  "editor/marks/color-codes.ts": "oklch(), oklab()",
};

/** DOM APIs newer than Chromium 105. TypeScript's lib already keeps newer
 *  JavaScript built-ins out of our code. */
const DOM_APIS: { name: string; since: number; pattern: RegExp }[] = [
  {
    name: "document.startViewTransition",
    since: 111,
    pattern: /\bstartViewTransition\b/,
  },
  {
    name: "the popover API",
    since: 114,
    pattern: /\b(show|hide|toggle)Popover\(|\bpopover=/,
  },
  {
    name: "the scrollend event",
    since: 114,
    pattern: /["']scrollend["']|onScrollEnd\b/,
  },
  {
    name: "URL.canParse / URL.parse",
    since: 120,
    pattern: /\bURL\.(canParse|parse)\(/,
  },
  { name: "AbortSignal.any", since: 116, pattern: /\bAbortSignal\.any\(/ },
  { name: "CloseWatcher", since: 120, pattern: /\bCloseWatcher\b/ },
  { name: "scheduler.yield", since: 129, pattern: /\bscheduler\.yield\(/ },
  {
    name: "HTMLDialogElement.requestClose",
    since: 134,
    pattern: /\.requestClose\(/,
  },
  {
    name: "document.caretPositionFromPoint",
    since: 128,
    pattern: /\bcaretPositionFromPoint\(/,
  },
  { name: "EditContext", since: 121, pattern: /\bEditContext\b/ },
  {
    name: "Selection.getComposedRanges",
    since: 137,
    pattern: /\bgetComposedRanges\(/,
  },
  { name: "Element.moveBefore", since: 133, pattern: /\.moveBefore\(/ },
];

function files(dir: string, test: (name: string) => boolean): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return dir === SRC && SKIPPED.includes(name) ? [] : files(path, test);
    }
    return test(name) ? [path] : [];
  });
}

const rel = (path: string) => relative(SRC, path).split("\\").join("/");
const cssFiles = files(SRC, (name) => name.endsWith(".css"));
const scriptFiles = files(
  SRC,
  (name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name),
).filter((path) => !rel(path).startsWith("dev/"));

/** Whether `node` sits inside an @supports whose condition matches. */
function guarded(node: Node, pattern: RegExp): boolean {
  for (let p = node.parent; p; p = p.parent) {
    if (p.type === "atrule" && (p as AtRule).name === "supports") {
      if (pattern.test((p as AtRule).params)) return true;
    }
  }
  return false;
}

/** "file: what (Chromium N), at line L" for each unguarded use. */
function cssFindings(path: string): string[] {
  const root = postcss.parse(readFileSync(path, "utf8"), { from: path });
  const found: string[] = [];
  const at = (node: Node) => `${rel(path)}:${node.source?.start?.line}`;
  root.walkDecls((decl) => {
    const text = `${decl.prop}: ${decl.value}`;
    for (const f of CSS_FEATURES) {
      if (f.pattern.test(text) && !guarded(decl, f.pattern))
        found.push(`${at(decl)} ${f.name} (Chromium ${f.since})`);
    }
  });
  root.walkRules((rule) => {
    for (const f of CSS_FEATURES) {
      if (f.pattern.test(rule.selector) && !guarded(rule, f.pattern))
        found.push(`${at(rule)} ${f.name} (Chromium ${f.since})`);
    }
    // Nesting: a style rule inside another, or a selector with &. The build
    // would lower it, the dev server and the theme export wouldn't.
    if (rule.parent?.type === "rule" || /&/.test(rule.selector))
      found.push(`${at(rule)} CSS nesting (Chromium 112)`);
  });
  root.walkAtRules((rule) => {
    for (const f of AT_RULES) {
      if (f.test(rule))
        found.push(`${at(rule)} ${f.name} (Chromium ${f.since})`);
    }
  });
  return found;
}

describe("stylesheets work in the oldest supported engine", () => {
  it("use nothing newer than Chromium 105 outside an @supports that tests for it", () => {
    expect(cssFiles.flatMap(cssFindings)).toEqual([]);
  });

  it("aren't set from the code with what the build can't lower", () => {
    const found = scriptFiles.flatMap((path) => {
      const file = rel(path);
      const code = readFileSync(path, "utf8");
      return SCRIPT_CSS.filter(
        (f) => f.pattern.test(code) && SCRIPT_ALLOWED[file] !== f.name,
      ).map((f) => `${file}: ${f.name} (Chromium ${f.since})`);
    });
    expect(found).toEqual([]);
  });
});

describe("the code works in the oldest supported engine", () => {
  it("calls no DOM API newer than Chromium 105", () => {
    const found = scriptFiles.flatMap((path) => {
      const code = readFileSync(path, "utf8").replace(
        /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,
        "",
      );
      return DOM_APIS.filter((api) => api.pattern.test(code)).map(
        (api) => `${rel(path)}: ${api.name} (Chromium ${api.since})`,
      );
    });
    expect(found).toEqual([]);
  });
});
