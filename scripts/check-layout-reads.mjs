#!/usr/bin/env node
// The window's frame is laid out by the engine (design-language.md 5.7):
// the solver places the islands, their rows and tabs, the clock moves
// them, and everything around them reads those numbers (frame-store,
// tab-strips). Code there doesn't read the page's layout back - a rect,
// an offset, a computed style - to patch it afterwards. The few reads
// that are the engine's inputs say so in ALLOWED, with why.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** The frame and what lies around it. */
const ROOTS = [
  "src/engine/frame",
  "src/engine/layout",
  "src/engine/controls/tabs",
  "src/app/frame",
  "src/app/islands",
  "src/app/tabs",
];

const READ =
  /\b(getBoundingClientRect|getClientRects|offset(?:Width|Height|Left|Top)|client(?:Width|Height)|getComputedStyle)\b/;

/** "file": why its reads are inputs, not layout read back. */
const ALLOWED = {
  "src/engine/frame/useIslandRoom.ts":
    "the room the area has: the solver's one input from the page",
  "src/engine/controls/tabs/tab-room.ts":
    "a tab's measures as its stylesheet draws them (a probe), not where it is",
  "src/engine/layout/row-insets.ts":
    "the window bar's own controls and the layout's radii, outside the frame",
  "src/app/frame/SidebarTabBar.tsx":
    "the sidebar's own width, for how many of its tabs show; a menu's anchor",
  "src/app/frame/WindowControls.tsx": "a menu's anchor: the button pressed",
  "src/app/frame/ActivityRail.tsx":
    "the rail's groups, a list its stylesheet places, at a drag's end",
  "src/app/frame/rail-lift.ts":
    "the rail's groups, a list its stylesheet places, as an icon is carried",
};

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) yield path;
  }
}

const found = [];
const used = new Set();
for (const root of ROOTS)
  for (const path of files(root)) {
    const file = path.split("\\").join("/");
    readFileSync(path, "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (/^\s*(\/\/|\*)/.test(line) || !READ.test(line)) return;
        if (file in ALLOWED) used.add(file);
        else found.push(`${file}:${i + 1}: ${line.trim()}`);
      });
  }

const stale = Object.keys(ALLOWED).filter((file) => !used.has(file));
if (found.length || stale.length) {
  if (found.length)
    console.error(
      "Layout read back from the page around the frame; take it from the solve (frame-store, tab-strips) instead:\n  " +
        found.join("\n  "),
    );
  if (stale.length)
    console.error(
      "Allowed in check-layout-reads.mjs but no longer reading:\n  " +
        stale.join("\n  "),
    );
  process.exit(1);
}
