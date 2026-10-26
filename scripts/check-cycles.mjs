// Import cycles in src/: modules that, through their imports, end up
// importing themselves. A cycle ties its modules into one - none can be
// read, tested or loaded lazily on its own - so the frontend keeps none.
// Type-only imports leave nothing at runtime and don't count; nor do
// dynamic import()s, which load later by design.
//   node scripts/check-cycles.mjs          lists them, fails if any
//   node scripts/check-cycles.mjs --list   lists them, exits 0

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(root, "src");
const EXTENSIONS = [".ts", ".tsx", ".js", ".mjs"];

function sources(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sources(path));
    else if (/\.(tsx?|m?js)$/.test(name) && !/\.test\.|\.spec\./.test(name))
      out.push(path);
  }
  return out;
}

/** The module a relative specifier names, if it is one of ours. */
function resolveSpec(from, spec) {
  if (!spec.startsWith(".")) return null;
  const base = resolve(dirname(from), spec.replace(/\?.*$/, ""));
  for (const candidate of [
    base,
    ...EXTENSIONS.map((e) => base + e),
    ...EXTENSIONS.map((e) => join(base, "index" + e)),
  ])
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  return null;
}

/** What a module imports at load: static imports and re-exports, not
 *  `import type` / `export type`, not import(). */
function importsOf(path) {
  const text = readFileSync(path, "utf8");
  const out = new Set();
  const pattern =
    /^\s*(import|export)\s+(type\s+)?(?:[^'"`;]*?\sfrom\s+)?["']([^"']+)["']/gm;
  for (const m of text.matchAll(pattern)) {
    if (m[2]) continue;
    // `import { type A, type B } from` is type-only too.
    const clause = /\{([^}]*)\}/.exec(m[0])?.[1];
    if (
      clause &&
      !/^\s*(import|export)\s+[\w*]/.test(m[0].replace(/\{[\s\S]*$/, "")) &&
      clause
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .every((s) => s.startsWith("type "))
    )
      continue;
    const target = resolveSpec(path, m[3]);
    if (target) out.add(target);
  }
  return out;
}

const files = sources(SRC);
const graph = new Map(files.map((f) => [f, importsOf(f)]));

// Tarjan's strongly connected components: each with more than one module
// (or one importing itself) is a cycle.
let index = 0;
const stack = [];
const on = new Set();
const idx = new Map();
const low = new Map();
const cycles = [];
function connect(v) {
  idx.set(v, index);
  low.set(v, index);
  index++;
  stack.push(v);
  on.add(v);
  for (const w of graph.get(v) ?? []) {
    if (!graph.has(w)) continue;
    if (!idx.has(w)) {
      connect(w);
      low.set(v, Math.min(low.get(v), low.get(w)));
    } else if (on.has(w)) low.set(v, Math.min(low.get(v), idx.get(w)));
  }
  if (low.get(v) === idx.get(v)) {
    const part = [];
    let w;
    do {
      w = stack.pop();
      on.delete(w);
      part.push(w);
    } while (w !== v);
    if (part.length > 1 || graph.get(v)?.has(v)) cycles.push(part);
  }
}
for (const f of files) if (!idx.has(f)) connect(f);

for (const part of cycles.sort((a, b) => b.length - a.length))
  console.log(
    `${part.length} modules: ${part
      .map((p) => relative(SRC, p))
      .sort()
      .join(", ")}`,
  );
console.log(`${cycles.length} import cycles in src/`);
if (cycles.length && !process.argv.includes("--list")) process.exit(1);
