#!/usr/bin/env node
// A touch leaves :hover on the last thing tapped, so a hover tint belongs
// to devices that hover: a rule that only paints (background, colour,
// borders, shadows) on :hover sits under @media (any-hover: hover). Rules that
// reveal a control (opacity, visibility), undo a tint, or group :hover with
// focus inside :is() are left as they are; so is the phone's own CSS.
// A press tints with one of the pressed tokens, so the app presses one way;
// the OS-drawn caption buttons, the document's own and danger keep theirs.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import postcss from "postcss";

const PAINT =
  /^(background(-color|-image)?|color|border(-[a-z]+)?-color|box-shadow|text-decoration(-[a-z]+)?|text-underline-offset|outline(-color|-offset)?|fill|stroke|transition(-[a-z]+)?|--[a-z0-9-]+)$/;
const UNDONE = /^(none|transparent|inherit|initial|unset)$/;
const PRESSED =
  /^(var\(--ui-(pressed|pressed-row|primary-pressed)\)|none|transparent)$/;
const OWN_PRESS = /window-caption|document-view|\.danger/;

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== "mobile") yield* files(path);
    } else if (name.endsWith(".css")) yield path;
  }
}

const hovers = (rule) => {
  for (let p = rule.parent; p; p = p.parent)
    if (p.type === "atrule" && /hover:\s*hover/.test(p.params)) return true;
  return false;
};

const problems = [];
for (const file of files("src")) {
  postcss.parse(readFileSync(file, "utf8")).walkRules((rule) => {
    if (
      rule.selector.includes(":active") &&
      !OWN_PRESS.test(file + rule.selector)
    )
      for (const d of rule.nodes)
        if (
          d.type === "decl" &&
          /^background(-color)?$/.test(d.prop) &&
          !PRESSED.test(d.value.trim())
        )
          problems.push(
            `${file}:${d.source.start.line}: ${d.value} - a press tints with --ui-pressed, --ui-pressed-row or --ui-primary-pressed`,
          );
    if (!rule.selector.includes(":hover") || hovers(rule)) return;
    if (rule.parent.type === "rule") return;
    const decls = rule.nodes.filter((n) => n.type === "decl");
    if (!decls.length || !decls.every((d) => PAINT.test(d.prop))) return;
    const painted = decls.filter((d) => !d.prop.startsWith("transition"));
    if (painted.every((d) => UNDONE.test(d.value.trim()))) return;
    const own = rule.selectors.filter((s) => s.includes(":hover"));
    if (own.some((s) => /:(is|where|not)\([^)]*:hover/.test(s))) return;
    problems.push(
      `${file}:${rule.source.start.line}: ${own.join(", ")} - a hover tint goes under @media (any-hover: hover)`,
    );
  });
}
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(
  "hover: every hover tint is for devices that hover, every press a token",
);
