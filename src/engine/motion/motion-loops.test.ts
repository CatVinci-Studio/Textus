import { readFileSync, readdirSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Movement written in script goes through engine/motion (animate, tween,
// the moves) or the frame clock, so timing, easing and reduced motion are
// one thing. What steps outside is listed here with its reason.

const SRC = fileURLToPath(new URL("../..", import.meta.url));

/** `file callback`: a frame callback that asks for the next frame itself. */
const OWN_LOOPS: Record<string, string> = {
  "engine/frame/clock.ts tick": "the frame clock",
  "engine/motion/tween.ts tick": "the shared tween",
  "engine/motion/reveal.ts step": "the shared reveal",
  "engine/drag/edge-scroll.ts run": "the shared edge scroll",
  "ai/revision/stream-follow-plugin.ts tick": "follows a growing rewrite",
  // Waits a few frames for something to be drawn; nothing moves.
  "app/useSourceModes.ts place": "until the source view exists",
  "app/hold-on-return.ts drawn": "until the page settles",
  "settings/SettingsSearch.tsx go": "until the entry is drawn",
};

/** Files that read the system setting itself rather than motionAllowed(). */
const OWN_REDUCED_MOTION: Record<string, string> = {
  // The streaming rewrite's sentence-by-sentence layout is a way of
  // reading, kept where only the stylesheet stops animation (the e2e).
  "ai/editor-plugins.ts": "streaming layout",
  "ai/revision/pending-decorations.ts": "streaming layout",
  "ai/revision/pending-widgets.ts": "streaming layout",
  "document-view/useProposalFlow.ts": "streaming layout",
};

/** Files that write a transition into an element's style. */
const OWN_TRANSITIONS: Record<string, string> = {};

function sources(): [string, string][] {
  return readdirSync(SRC, { recursive: true, encoding: "utf8" })
    .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
    .map((file) => [
      file.split(sep).join("/"),
      readFileSync(join(SRC, file), "utf8"),
    ]);
}

/** The frame callbacks in `text` that call requestAnimationFrame on
 *  themselves, from inside their own body. */
export function selfScheduled(text: string): string[] {
  const found = new Set<string>();
  const calls = [
    ...text.matchAll(
      /requestAnimationFrame\(\s*(?:this\.)?([A-Za-z_$][\w$]*)\s*\)/g,
    ),
    ...text.matchAll(
      /requestAnimationFrame\(\s*\(\w*(?::\s*\w+)?\)\s*=>\s*this\.([A-Za-z_$][\w$]*)\(/g,
    ),
  ].map((m) => [m[1], m.index] as const);
  for (const [name, at] of calls) {
    const definition = new RegExp(
      `(?:function\\s+${name}\\b|\\b${name}\\s*=(?!=)|^\\s*(?:private\\s+|protected\\s+|public\\s+)?${name}\\s*\\()`,
      "gm",
    );
    const from = [...text.matchAll(definition)]
      .map((m) => m.index)
      .filter((i) => i < at)
      .at(-1);
    if (from === undefined) continue;
    const open = text.indexOf("{", from);
    if (open < 0 || open > at || text.slice(from, open).includes(";")) continue;
    let depth = 0;
    let inside = true;
    for (let i = open; i < at && inside; i++) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}" && --depth === 0) inside = false;
    }
    if (inside) found.add(name);
  }
  return [...found];
}

describe("motion in script", () => {
  const files = sources();

  it("finds a loop, and not a callback that only runs once", () => {
    expect(
      selfScheduled(
        `const step = () => { x++; frame = requestAnimationFrame(step); };`,
      ),
    ).toEqual(["step"]);
    expect(
      selfScheduled(
        `class A {\n  private tick(t: number) {\n    requestAnimationFrame((n) => this.tick(n));\n  }\n}`,
      ),
    ).toEqual(["tick"]);
    expect(
      selfScheduled(
        `const draw = () => { x++; };\nconst later = () => { requestAnimationFrame(draw); };`,
      ),
    ).toEqual([]);
  });

  it("runs its loops through the engine, or says why not", () => {
    const loops = files.flatMap(([file, text]) =>
      selfScheduled(text).map((name) => `${file} ${name}`),
    );
    expect(loops.filter((loop) => !(loop in OWN_LOOPS))).toEqual([]);
    expect(
      Object.keys(OWN_LOOPS).filter((loop) => !loops.includes(loop)),
    ).toEqual([]);
  });

  it("asks motionAllowed() whether to move, or says why not", () => {
    const own = files
      .filter(
        ([file, text]) =>
          !file.startsWith("engine/motion/") &&
          /\bprefersReducedMotion\(/.test(text),
      )
      .map(([file]) => file);
    expect(own.filter((file) => !(file in OWN_REDUCED_MOTION))).toEqual([]);
    expect(
      Object.keys(OWN_REDUCED_MOTION).filter((file) => !own.includes(file)),
    ).toEqual([]);
  });

  it("writes no transitions into a style, or says why", () => {
    const own = files
      .filter(([, text]) =>
        /\.style\.transition\s*=|setProperty\(\s*["']transition["']/.test(text),
      )
      .map(([file]) => file);
    expect(own.filter((file) => !(file in OWN_TRANSITIONS))).toEqual([]);
    expect(
      Object.keys(OWN_TRANSITIONS).filter((file) => !own.includes(file)),
    ).toEqual([]);
  });
});
