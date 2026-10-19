#!/usr/bin/env node
// Runs the save round trip on the whole corpus (docs/dev/saving.md), one
// vitest process per shard, and prints what failed, by kind.
//
//   npm run test:roundtrip                  (fetch the corpus first:
//   npm run test:roundtrip -- --shards 4     node scripts/roundtrip-corpus/fetch.mjs)
//   npm run test:roundtrip -- --rounds 3    (each edit kind three times per file)
//
// The merged report is .cache/roundtrip-corpus/report/summary.json.
import { spawn } from "node:child_process";
import { availableParallelism } from "node:os";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const reportDir = join(root, ".cache/roundtrip-corpus/report");
const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 ? process.argv[at + 1] : fallback;
};
const shards = Number(
  arg("shards", Math.max(1, Math.floor(availableParallelism() / 2))),
);
const rounds = arg("rounds", "1");

if (!existsSync(join(root, ".cache/roundtrip-corpus/manifest.json")))
  console.warn(
    "No corpus yet - run node scripts/roundtrip-corpus/fetch.mjs. Checking this repository's docs only.",
  );

const runShard = (shard) =>
  new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        join(root, "node_modules/vitest/vitest.mjs"),
        "run",
        "src/document-view/save-roundtrip-corpus.test.ts",
        "--reporter=dot",
      ],
      {
        cwd: root,
        stdio: ["ignore", "ignore", "inherit"],
        env: {
          ...process.env,
          ROUNDTRIP_CORPUS: "1",
          ROUNDTRIP_SHARD: `${shard}/${shards}`,
          ROUNDTRIP_ROUNDS: rounds,
        },
      },
    );
    child.on("exit", resolve);
  });

const started = Date.now();
await Promise.all(Array.from({ length: shards }, (_, i) => runShard(i + 1)));

const reports = {};
for (let shard = 1; shard <= shards; shard++) {
  const path = join(reportDir, `shard-${shard}-of-${shards}.json`);
  // A shard that crashed left an older run's report, or none.
  if (existsSync(path) && statSync(path).mtimeMs >= started)
    Object.assign(reports, JSON.parse(readFileSync(path, "utf8")));
  else console.warn(`Shard ${shard} wrote no report: see its output above.`);
}

const failures = {};
const known = [];
const edits = {};
const serializeOnly = {};
let unpaired = 0;
let unkept = 0;
let neighbours = 0;
let blocks = 0;
for (const [id, report] of Object.entries(reports)) {
  for (const failure of report.failures)
    (failures[failure.kind] ??= []).push({ id, ...failure });
  for (const failure of report.known ?? []) known.push({ id, ...failure });
  for (const [kind, count] of Object.entries(report.edits))
    edits[kind] = (edits[kind] ?? 0) + count;
  for (const [kind, count] of Object.entries(report.serializeOnly))
    serializeOnly[kind] = (serializeOnly[kind] ?? 0) + count;
  if (report.unpaired) unpaired++;
  unkept += report.unkept.length;
  neighbours += report.neighboursSerialized;
  blocks += report.blocks;
}

const files = Object.keys(reports).length;
console.log(
  `\n${files} files, ${Object.values(edits).reduce((a, b) => a + b, 0)} edits in ${Math.round((Date.now() - started) / 1000)} s`,
);
console.log("Edits made:", edits);
console.log(`Files whose blocks didn't pair on opening: ${unpaired}`);
console.log(`Blocks changed on load (serialized on every save): ${unkept}`);
console.log(`Kept neighbours serialized by the join check: ${neighbours}`);
console.log("\nFailures:");
for (const [kind, list] of Object.entries(failures)) {
  console.log(`  ${kind}: ${list.length}`);
  for (const failure of list.slice(0, 5))
    console.log(
      `    ${failure.id} [${failure.edit} seed ${failure.seed}] ${failure.detail.slice(0, 300)}`,
    );
}
if (!Object.keys(failures).length) console.log("  none");
console.log(
  `\nKnown, each a case docs/dev/saving.md explains: ${known.length}`,
);
for (const failure of known)
  console.log(`  ${failure.id} [${failure.edit} seed ${failure.seed}]`);
const differing = Object.values(serializeOnly).reduce((a, b) => a + b, 0);
console.log(
  `\nSerialize-only differences, for information: ${differing} of ${blocks} blocks`,
);
for (const [kind, count] of Object.entries(serializeOnly).sort(
  (a, b) => b[1] - a[1],
))
  console.log(`  ${kind}: ${count}`);

writeFileSync(
  join(reportDir, "summary.json"),
  JSON.stringify(
    {
      files,
      edits,
      unpaired,
      unkept,
      neighbours,
      blocks,
      failures,
      known,
      serializeOnly,
    },
    null,
    2,
  ),
);
process.exitCode = Object.keys(failures).length ? 1 : 0;
