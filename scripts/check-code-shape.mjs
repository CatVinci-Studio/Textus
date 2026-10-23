#!/usr/bin/env node
// Checks the shape rules in CONTRIBUTING.md ("Code shape"):
//
//   - a source file holds at most 600 lines (tests, the translation and
//     icon tables and the dev shim aside);
//   - a React component calls at most 8 hooks - more is a component doing
//     several things, and its concerns become hooks of their own;
//   - no code outside a provider's own adapter compares a provider's id:
//     what differs between providers is data (the catalog, capabilities.rs,
//     a table), not an `if`.
//
// A few files and components are over a limit today. They are listed below
// with what they are at now: they may shrink, not grow, and the number
// comes down with them.
//
//   node scripts/check-code-shape.mjs     (exit 1 on any breach)
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const MAX_LINES = 600;
const MAX_HOOKS = 8;

/** Over the line limit today: at most this many lines. */
const LINES_NOW = {};

/** Over the hook limit today: the roots that wire a window together. */
const HOOKS_NOW = {
  "src/app/App.tsx App": 54,
  "src/ai/chat/window/ChatWindowApp.tsx ChatWindowApp": 30,
};

/** Not held to the line limit: tables, not logic. */
const TABLES = [/^src\/i18n\/locales\//, /^src\/ui\/icons\.tsx$/];

function walk(dir, out = []) {
  for (const name of readdirSync(join(root, dir))) {
    const path = `${dir}/${name}`;
    if (name === "node_modules" || name === "target") continue;
    if (statSync(join(root, path)).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

const isTest = (path) =>
  /\.(test|spec)\.tsx?$/.test(path) ||
  /(^|\/)tests?(\.rs|\/)/.test(path) ||
  /_tests\.rs$/.test(path) ||
  // The live evals are test code (#[cfg(test)] mod live_eval).
  path.includes("/live_eval/") ||
  path.startsWith("src/dev/");

const sources = [
  ...walk("src").filter((p) => /\.tsx?$/.test(p)),
  ...walk("src-tauri/src").filter((p) => p.endsWith(".rs")),
  ...walk("src-tauri/crates").filter((p) => p.endsWith(".rs")),
].filter((p) => !isTest(p));

const problems = [];

// Lines.
for (const path of sources) {
  if (TABLES.some((re) => re.test(path))) continue;
  const lines = readFileSync(join(root, path), "utf8").split("\n").length - 1;
  const cap = LINES_NOW[path] ?? MAX_LINES;
  if (lines > cap)
    problems.push(
      `${path}: ${lines} lines, over ${cap} - split it by concern (CONTRIBUTING.md, "Code shape")`,
    );
}

// Hooks per component.
const COMPONENT =
  /^(?:export )?(?:default )?(?:function ([A-Z]\w*)|const ([A-Z]\w*) = (?:memo\()?(?:function \w*)?)/gm;
const NEXT_DECLARATION =
  /^(?:export )?(?:function|const|let|interface|type|class) [a-z_]/gm;
const HOOK = /(?<![\w.])use[A-Z]\w*\s*(?:<(?:[^<>]|<[^<>]*>)*>)?\s*\(/g;
for (const path of sources.filter((p) => p.endsWith(".tsx"))) {
  const text = readFileSync(join(root, path), "utf8");
  const starts = [...text.matchAll(COMPONENT)].map((m) => ({
    at: m.index,
    name: m[1] ?? m[2],
  }));
  starts.forEach(({ at, name }, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].at : text.length;
    NEXT_DECLARATION.lastIndex = at + 1;
    const next = NEXT_DECLARATION.exec(text);
    const body = text.slice(at, next && next.index < end ? next.index : end);
    const hooks = body.match(HOOK)?.length ?? 0;
    const cap = HOOKS_NOW[`${path} ${name}`] ?? MAX_HOOKS;
    if (hooks > cap)
      problems.push(
        `${path}: ${name} calls ${hooks} hooks, over ${cap} - move a concern into a hook of its own`,
      );
  });
}

// Provider ids compared in code. The ids are the catalog's; "custom" is
// the user's own endpoint, not a provider.
const catalog = readFileSync(join(root, "src-tauri/src/ai/catalog.rs"), "utf8");
const ids = [...catalog.matchAll(/^\s+id: "([a-z0-9-]+)"/gm)]
  .map((m) => m[1])
  .filter((id) => id !== "custom");
const alt = ids.map((id) => id.replace(/-/g, "\\-")).join("|");
const TS_COMPARE = new RegExp(
  `(?:===|!==)\\s*["'](?:${alt})["']|["'](?:${alt})["']\\s*(?:===|!==)|case\\s+["'](?:${alt})["']\\s*:`,
);
const RS_COMPARE = new RegExp(
  `(?:==|!=)\\s*"(?:${alt})"|"(?:${alt})"\\s*(?:=>|\\|)`,
);
// A provider's own adapter is where its differences are written down.
const ADAPTERS = [
  /^src-tauri\/crates\/aicompat\/src\/(providers|images)\//,
  /^src-tauri\/crates\/aicompat\/src\/capabilities/,
  /^src-tauri\/src\/ai\/catalog/,
];
for (const path of sources) {
  if (ADAPTERS.some((re) => re.test(path))) continue;
  const compare = path.endsWith(".rs") ? RS_COMPARE : TS_COMPARE;
  readFileSync(join(root, path), "utf8")
    .split("\n")
    .forEach((line, i) => {
      const code = line.trim();
      if (code.startsWith("//") || code.startsWith("*")) return;
      if (compare.test(code))
        problems.push(
          `${path}:${i + 1}: compares a provider id - make the difference data`,
        );
    });
}

if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(
  `code shape: ${sources.length} files within ${MAX_LINES} lines, components within ${MAX_HOOKS} hooks, no provider ids compared`,
);
