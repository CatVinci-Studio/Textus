#!/usr/bin/env node
// No fixed screen pixels in script (design-language.md 5.6): a constant
// named as a size - WIDTH, HEIGHT, GAP, MARGIN, EDGE... - must be drawn at
// the interface's size wherever it is used: through scaledPx(), or times a
// scale (chrome, zoom) on the same line. Sizes that follow something else
// say so in ALLOWED, with why.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SIZE =
  /^(?:export\s+)?const\s+([A-Z][A-Z0-9_]*)\s*=\s*[1-9]\d*(?:\.\d+)?\s*;/;
const SIZE_NAME =
  /(WIDTH|HEIGHT|SIZE|MARGIN|GAP|EDGE|PADDING|_PX|INSET|SNAP|OUTER|NEAR)$/;
const SCALED = /scaledPx\(|chrome|[sS]cale\b|zoom|step\b/;

/** "file:NAME": why that size doesn't take the chrome scale. */
const ALLOWED = {
  "src/ui/side-panel-width.ts:DOCUMENT_MIN_WIDTH":
    "interface px; callers pass the scale",
  "src/app/frame/sidebar-width.ts:SIDEBAR_DEFAULT_WIDTH":
    "interface px, drawn times the scale",
  "src/app/frame/sidebar-width.ts:SIDEBAR_MIN_WIDTH":
    "interface px, drawn times the scale",
  "src/ai/chat/panel/agent-panel.tsx:AGENT_PANEL_DEFAULT_WIDTH":
    "interface px, drawn times the scale",
  "src/ai/chat/panel/agent-panel.tsx:AGENT_PANEL_MIN_WIDTH":
    "interface px, drawn times the scale",
  "src/ai/chat/panel/agent-panel.tsx:AGENT_PANEL_MAX_WIDTH":
    "interface px, drawn times the scale",
  "src/editor/tables/table-hover-view.ts:DEFAULT_CELL_MIN_WIDTH":
    "the document's table: the document's zoom",
  "src/export/diagram-images.ts:MAX_WIDTH": "an exported picture",
  "src/plugins/views/PluginWebview.tsx:MAX_CODE_BLOCK_HEIGHT":
    "a cap on a block in the document",
  "src/editor/images/image-plugin.ts:BADGE_HEIGHT_PX":
    "the picture's own pixels",
  "src/editor/lazy-blocks/estimate-height.ts:FIGURE_HEIGHT":
    "the document's content: its zoom",
  "src/editor/markdown/task-list-plugin.ts:CHECKBOX_HIT_WIDTH":
    "the document's content: its zoom",
  "src/plugins/contributions/editor-scroll.ts:SCROLL_MARGIN":
    "the document's scrolling: its zoom",
  "src/editor/marks/enclosure.ts:DOUBLE_CLICK_PX":
    "a pointer's slop, not a size drawn",
  "src/editor/mermaid-plugin.ts:RESIZE_REDRAW_PX":
    "a threshold for redrawing, not a size drawn",
  "src/engine/drag/pointer-drag.ts:DRAG_START_PX":
    "a pointer's slop, not a size drawn",
  "src/app/tabs/TabPill.tsx:LIFT_SLOP_PX": "a pointer's slop, not a size drawn",
  "src/app/tabs/TabPill.tsx:REORDER_THRESHOLD_PX":
    "a pointer's slop, not a size drawn",
  "src/ai/paper/figure-check.ts:WIDTH":
    "a figure drawn to be checked, not shown",
  "src/ai/revision/stream-follow-plugin.ts:NEAR":
    "the document's scrolling: its zoom",
  "src/editor/keys/drag-autoscroll-plugin.ts:EDGE":
    "the document's scrolling: its zoom",
  "src/editor/keys/keyboard-reveal-plugin.ts:MARGIN":
    "the document's scrolling: its zoom",
  "src/utils/nav-history.ts:NEAR": "places in the document: its zoom",
  "src/mobile/usePageSwipe.ts:EDGE": "the phone, whose chrome is 1",
};

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (!/^(i18n|dev|ios)$/.test(name)) yield* files(path);
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) yield path;
  }
}

const sources = [...files("src")].map((file) => ({
  file,
  lines: readFileSync(file, "utf8").split("\n"),
}));
const problems = [];
for (const { file, lines } of sources) {
  for (const [at, line] of lines.entries()) {
    const name = SIZE.exec(line)?.[1];
    if (!name || !SIZE_NAME.test(name) || ALLOWED[`${file}:${name}`]) continue;
    const use = new RegExp(`\\b${name}\\b`);
    // Exported: in its own file and wherever it is imported from there.
    const module = file.replace(/^.*\//, "").replace(/\.tsx?$/, "");
    const imports = (text) =>
      new RegExp(`\\b${name}\\b[\\s\\S]*from "[^"]*\\/${module}"`).test(text);
    const where = /^\s*export/.test(line)
      ? sources.filter((o) => o.file === file || imports(o.lines.join("\n")))
      : [{ file, lines }];
    for (const other of where)
      other.lines.forEach((text, j) => {
        if (other.file === file && j === at) return;
        if (!use.test(text) || SCALED.test(text)) return;
        if (/^\s*(\/\/|\*|import|[A-Z_]+,$)/.test(text)) return;
        problems.push(
          `${other.file}:${j + 1}: ${name} drawn unscaled - use scaledPx(${name})`,
        );
      });
  }
}
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log("sizes: every size constant is drawn at the interface's size");
