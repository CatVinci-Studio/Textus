#!/usr/bin/env node
// The interface's text is the type scale's (design-system.css --text-*), so
// a panel, a dialog or Settings reads at the size the rest does. A fixed
// font-size (px, rem, pt) in a stylesheet must say why in ALLOWED: the
// document's own text, a glyph sized to its badge, the phone's own rules.
// Sizes relative to the text around them (em, %) are fine.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const FIXED = /font-size:\s*([^;]*\d(?:px|rem|pt)\b[^;]*);/;
const TOKEN = /var\(--text-/;

/** Files (or folders, ending in /) whose fixed sizes are meant, with why. */
const ALLOWED_FILES = {
  "src/ui/design-system.css": "the type scale itself",
  "src/app/editor-column.css": "the document's text, at its zoom",
  "src/theme/content-base.css": "the document's text",
  "src/editor/milkdown-theme.css": "the document's text",
  "src/ui/Select.css":
    "an invisible native select: 16px keeps iOS from zooming",
  "src/mobile/": "the phone's own type (its --text-* follow Dynamic Type)",
};
/** A glyph drawn to fit a fixed-size badge or button: the sizes allowed
 *  in that file. */
const GLYPHS = {
  "src/ai/margin/ReviewMargin.css": ["8.5px", "9.5px", "8px", "12px"],
  "src/ai/chat/inline-chat.css": ["10.5px"],
  "src/onboarding/TutorialOverlay.css": ["8px"],
  "src/editor/diagram-zoom.css": ["1.2rem", "1.5rem"],
};

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else if (name.endsWith(".css")) yield path;
  }
}

const problems = [];
for (const file of files("src")) {
  if (
    Object.keys(ALLOWED_FILES).some(
      (allowed) =>
        file === allowed || (allowed.endsWith("/") && file.startsWith(allowed)),
    )
  )
    continue;
  readFileSync(file, "utf8")
    .split("\n")
    .forEach((line, at) => {
      const value = FIXED.exec(line)?.[1].trim();
      if (!value || TOKEN.test(value)) return;
      if (GLYPHS[file]?.includes(value)) return;
      problems.push(
        `${file}:${at + 1}: font-size ${value} - use a --text-* size (design-system.css)`,
      );
    });
}
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log("text sizes: the interface's text is the type scale's");
