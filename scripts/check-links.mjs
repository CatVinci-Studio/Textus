#!/usr/bin/env node
// Every relative link in the repository's documentation leads to a file
// that is there: `[text](../dev/guide.md#part)` and `![](pictures/a.png)`.
// Markdown under src/, e2e/ and src-tauri/ is the app's content (prompts,
// guides, test input), not documentation. Links to the web, mail and
// anchors in the same page are not followed.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The targets of a Markdown text's inline links and pictures, outside code. */
export function linkTargets(markdown) {
  const text = markdown
    .replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, "")
    .replace(/`[^`\n]*`/g, "");
  const targets = [];
  for (const [, target] of text.matchAll(
    /\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g,
  ))
    targets.push(target);
  return targets;
}

/** Whether a target is a file in this repository to look for. */
export function isLocal(target) {
  return !/^([a-z][a-z0-9+.-]*:|#|\/|\{)/i.test(target);
}

/** The broken relative links in `files` (paths from `base`). */
export function brokenLinks(files, base = root) {
  const broken = [];
  for (const file of files) {
    const from = dirname(join(base, file));
    for (const target of linkTargets(readFileSync(join(base, file), "utf8"))) {
      if (!isLocal(target)) continue;
      const path = decodeURIComponent(target.split(/[#?]/)[0]);
      if (path && !existsSync(resolve(from, path)))
        broken.push(`${file}: ${target}`);
    }
  }
  return broken;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = execFileSync("git", ["ls-files", "*.md"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\n")
    .filter((file) => file && !/^(src|e2e|src-tauri)\//.test(file));
  const broken = brokenLinks(files);
  if (broken.length) {
    console.error(`Broken links:\n  ${broken.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`${files.length} Markdown files, every relative link found`);
}
