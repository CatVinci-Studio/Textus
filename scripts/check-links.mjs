#!/usr/bin/env node
// Every relative link in the repository's documentation leads to a file
// that is there: `[text](../dev/guide.md#part)` and `![](pictures/a.png)`.
// Markdown under src/, e2e/ and src-tauri/ is the app's content (prompts,
// guides, test input), not documentation. Links to the web, mail and
// anchors in the same page are not followed.
//
// The developer and design docs also name source files in code spans
// (`src/app/App.tsx`, `lib.rs:42`); each must still be a file in the
// repository, so a moved or deleted file takes its docs along.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** A Markdown text without its fenced code blocks. */
const withoutFences = (markdown) =>
  markdown.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, "");

/** The targets of a Markdown text's inline links and pictures, outside code. */
export function linkTargets(markdown) {
  const text = withoutFences(markdown).replace(/`[^`\n]*`/g, "");
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

/** The source files a Markdown text names in its code spans, outside
 *  fenced blocks: a path or a bare file name, a line number dropped. Data
 *  files (`settings.json`) are the user's, not the repository's. */
export function codePaths(markdown) {
  const paths = [];
  for (const [, path] of withoutFences(markdown).matchAll(
    /`([\w.\-/]+\.(?:tsx?|rs|css|mjs|js|sh|ya?ml))(?::[\d-]+)?`/g,
  ))
    paths.push(path);
  return paths;
}

/** Names the docs use as patterns, not as files. */
const EXAMPLE_NAMES = new Set([
  "x.ts",
  "x.test.ts",
  "kebab-case.ts",
  "PascalCase.tsx",
  "name.test.ts",
  "name.spec.ts",
  "snake_case.rs",
  "verb-noun.mjs",
  ".d.ts",
  // A theme file in the user's data folder (storage.md).
  "dark.css",
]);

/** Whether `path` is one of `tracked` (repository paths): a bare name
 *  anywhere, a partial path (`editor/markdown/doc-blocks.ts`) at the end of
 *  one. */
function isTracked(path, tracked) {
  return tracked.some(
    (file) =>
      file === path ||
      file.endsWith(`/${path}`) ||
      (!path.includes("/") && basename(file) === path),
  );
}

/** The source files `files` (paths from `base`) name that `tracked` lacks. */
export function missingCodePaths(files, tracked, base = root) {
  const missing = [];
  for (const file of files) {
    const named = new Set(codePaths(readFileSync(join(base, file), "utf8")));
    for (const path of named)
      if (!EXAMPLE_NAMES.has(path) && !isTracked(path, tracked))
        missing.push(`${file}: ${path}`);
  }
  return missing;
}

/** The docs whose code spans are checked: the developer and design docs.
 *  The plugin author's guide names a plugin's own files, the release notes
 *  files as they were. */
export const namesCode = (file) =>
  /^(AGENTS|CONTRIBUTING)\.md$|^docs\/(dev|design)\/[^/]+\.md$/.test(file);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const listed = (...args) =>
    execFileSync("git", ["ls-files", ...args], { cwd: root, encoding: "utf8" })
      .split("\n")
      .filter(Boolean);
  const files = listed("*.md").filter(
    (file) => !/^(src|e2e|src-tauri)\//.test(file),
  );
  // Files about to be added count as there: the check runs before a commit,
  // when a new file and the doc naming it are not yet staged.
  const tracked = listed("--cached", "--others", "--exclude-standard");
  const broken = brokenLinks(files);
  const missing = missingCodePaths(files.filter(namesCode), tracked);
  if (broken.length) console.error(`Broken links:\n  ${broken.join("\n  ")}`);
  if (missing.length)
    console.error(
      `Source files named in the docs that are not there:\n  ${missing.join("\n  ")}`,
    );
  if (broken.length || missing.length) process.exit(1);
  console.log(
    `${files.length} Markdown files, every relative link and named source file found`,
  );
}
