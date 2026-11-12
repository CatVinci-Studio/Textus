#!/usr/bin/env node
// Fails on code copied instead of shared: a run of 80 tokens or more found
// twice in src/ or src-tauri/src/ (jscpd), tests, tables and generated
// files aside. The copies there today are listed; they may go, not grow.
// `--list` prints every copy found and exits 0.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const IGNORE = [
  "**/*.test.ts",
  "**/*.test.tsx",
  "**/tests.rs",
  "**/tests/**",
  "**/*_tests.rs",
  "**/live_eval/**",
  "src/i18n/locales/**",
  "src/platform/bindings/**",
  "src/dev/**",
  "**/node_modules/**",
];

/** Copies there today, as "a | b" (sorted, from src/ or src-tauri/src/):
 *  how many each pair of files has. */
const COPIES_NOW = {
  "ai/revision/pending-accept.ts | ai/revision/pending-accept.ts": 1,
  "ai/rules/en/spelling.rs | ai/rules/shared.rs": 1,
  "ai/rules/ja/notation.rs | ai/rules/zh/spacing.rs": 1,
  "ai/rules/ru.rs | ai/rules/tw.rs": 1,
  "ai/rules/tw.rs | ai/rules/zh/wording.rs": 1,
  "ai/web/search.rs | ai/web/search.rs": 1,
  "editor/images/obsidian-embed.ts | editor/markdown/wikilink.ts": 1,
  "editor/marks/enclosure-moves.ts | editor/marks/enclosure-moves.ts": 1,
  "plugins/metadata.rs | plugins/workspace.rs": 1,
  "engine/controls/ContextMenu.tsx | engine/controls/ContextMenu.tsx": 1,
};

const out = mkdtempSync(join(tmpdir(), "textus-jscpd-"));
let report;
try {
  execFileSync(
    join(root, "node_modules/.bin/jscpd"),
    [
      "src",
      "src-tauri/src",
      "--format",
      "typescript,tsx,rust",
      "--min-tokens",
      "80",
      "--ignore",
      IGNORE.join(","),
      "--reporters",
      "json",
      "--output",
      out,
      "--silent",
    ],
    { cwd: root, stdio: ["ignore", "ignore", "inherit"] },
  );
  report = JSON.parse(readFileSync(join(out, "jscpd-report.json"), "utf8"));
} finally {
  rmSync(out, { recursive: true, force: true });
}

const found = {};
for (const d of report.duplicates) {
  const at = (f) => `${f.name}:${f.start}`;
  const key = [d.firstFile.name, d.secondFile.name].sort().join(" | ");
  (found[key] ??= []).push(`${at(d.firstFile)} and ${at(d.secondFile)}`);
}

if (process.argv.includes("--list")) {
  for (const [key, places] of Object.entries(found).sort())
    console.log(`"${key}": ${places.length},  // ${places.join("; ")}`);
  process.exit(0);
}

const problems = [];
for (const [key, places] of Object.entries(found)) {
  const allowed = COPIES_NOW[key] ?? 0;
  if (places.length > allowed)
    problems.push(
      `copied code: ${places.join("; ")} - share it (a function, a table, a component) instead`,
    );
}
for (const [key, allowed] of Object.entries(COPIES_NOW))
  if ((found[key]?.length ?? 0) < allowed)
    problems.push(
      `${key}: fewer copies than listed - lower or remove its entry in scripts/check-duplicates.mjs`,
    );

if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`duplicates: ${report.duplicates.length} known copies, none new`);
