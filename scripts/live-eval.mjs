#!/usr/bin/env node
// Runs the live evals, `#[ignore]`d Rust tests that spend real money, with
// cheap defaults: no judge, a $1 budget, keys from .env.local. Also
// `compare <before> <after>` and `baseline <run-dir> <provider>`.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const baselines = join(root, "src-tauri/src/ai/live_eval/baselines");

const SUITES = {
  matrix: "live_eval::live_agent_matrix",
  continuing: "live_eval::continuing",
  builtin: "live_eval::live_agent_builtin",
  completion: "live_eval::live_completion_matrix",
  grammar: "live_eval::live_grammar_matrix",
  all: "live_eval",
};
const PROVIDERS = [
  "anthropic",
  "chatgpt",
  "deepseek",
  "minimax",
  "doubao",
  "vertex",
];

function flags(args) {
  const out = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith("--")) out._.push(a);
    else if (a === "--judge") out.judge = true;
    else out[a.slice(2)] = args[++i];
  }
  return out;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function run(opts) {
  const provider = opts.provider ?? "anthropic";
  if (!PROVIDERS.includes(provider))
    fail(`--provider is one of ${PROVIDERS.join(", ")}`);
  const suite = opts.suite ?? "matrix";
  if (!SUITES[suite])
    fail(`--suite is one of ${Object.keys(SUITES).join(", ")}`);
  if (provider === "chatgpt" && suite !== "continuing" && !opts.filter)
    console.warn(
      "A whole suite on a ChatGPT plan can use up its limit for hours; " +
        "consider --filter.",
    );
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const out = resolve(
    opts.out ?? join(root, "tmp/live-eval", `${provider}-${suite}-${stamp}`),
  );
  mkdirSync(out, { recursive: true });
  const env = {
    ...process.env,
    TEXTUS_ENV_FILE: process.env.TEXTUS_ENV_FILE ?? join(root, ".env.local"),
    TEXTUS_EVAL_JUDGE: opts.judge ? "1" : "0",
    TEXTUS_EVAL_BUDGET_USD: opts.budget ?? "1",
    TEXTUS_EVAL_SPEND_FILE: join(out, "spend.json"),
    TEXTUS_EVAL_OUT: out,
  };
  if (provider !== "anthropic") env.TEXTUS_EVAL_PROVIDER = provider;
  if (opts.set === "core") {
    // The core set: a case or two per group, for runs while iterating.
    const ids = readFileSync(join(baselines, "core.txt"), "utf8")
      .split("\n")
      .filter((l) => l.trim() && !l.startsWith("#"));
    env.TEXTUS_EVAL_FILTER = ids.join(",");
  } else if (opts.set) fail("--set is core (or leave it out for every case)");
  if (opts.filter) env.TEXTUS_EVAL_FILTER = opts.filter;
  if (opts.model) env.TEXTUS_EVAL_AGENT_MODEL = opts.model;
  if (opts.jobs) env.TEXTUS_EVAL_JOBS = opts.jobs;
  console.log(`Writing to ${out}`);
  const result = spawnSync(
    "cargo",
    ["test", "--lib", SUITES[suite], "--", "--ignored", "--nocapture"],
    { cwd: join(root, "src-tauri"), env, stdio: "inherit" },
  );
  process.exit(result.status ?? 1);
}

/** case id -> passed, from a run folder's agent.jsonl or a baseline. */
export function results(path) {
  if (path.endsWith(".json")) {
    const b = JSON.parse(readFileSync(path, "utf8"));
    return new Map([
      ...b.passed.map((id) => [id, true]),
      ...b.failed.map((id) => [id, false]),
    ]);
  }
  const file = join(path, "agent.jsonl");
  if (!existsSync(file)) fail(`No agent.jsonl in ${path}`);
  const map = new Map();
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    // A case this provider can't run, one the budget skipped, and one that
    // never got an answer say nothing about the prompts either way.
    const skipped = ["not run", "budget", "request"];
    if (row.checks.some((c) => skipped.includes(c.name) && !c.ok)) continue;
    map.set(
      row.case,
      row.checks.every((c) => c.ok),
    );
  }
  return map;
}

/** The cases that changed between two result maps, both run in each. */
export function difference(before, after) {
  const broke = [];
  const fixed = [];
  for (const [id, ok] of after) {
    if (!before.has(id)) continue;
    if (before.get(id) && !ok) broke.push(id);
    if (!before.get(id) && ok) fixed.push(id);
  }
  return { broke: broke.sort(), fixed: fixed.sort() };
}

function compare([beforePath, afterPath]) {
  if (!beforePath || !afterPath) fail("compare <before> <after>");
  const before = results(beforePath);
  const after = results(afterPath);
  const passed = (m) => [...m.values()].filter(Boolean).length;
  const { broke, fixed } = difference(before, after);
  console.log(`before: ${passed(before)}/${before.size} pass`);
  console.log(`after:  ${passed(after)}/${after.size} pass`);
  console.log(`\nNow failing (${broke.length}):`);
  for (const id of broke) console.log(`  - ${id}`);
  console.log(`\nNow passing (${fixed.length}):`);
  for (const id of fixed) console.log(`  + ${id}`);
}

function baseline([dir, provider]) {
  if (!dir || !provider) fail("baseline <run-dir> <provider>");
  const map = results(dir);
  const ids = (ok) =>
    [...map]
      .filter(([, v]) => v === ok)
      .map(([id]) => id)
      .sort();
  mkdirSync(baselines, { recursive: true });
  const file = join(baselines, `${provider}.json`);
  writeFileSync(
    file,
    JSON.stringify(
      {
        provider,
        date: new Date().toISOString().slice(0, 10),
        passed: ids(true),
        failed: ids(false),
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`${file}: ${ids(true).length}/${map.size} pass`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, ...rest] = process.argv.slice(2);
  const opts = flags(rest);
  if (command === "run") run(opts);
  else if (command === "compare") compare(opts._);
  else if (command === "baseline") baseline(opts._);
  else fail("run | compare | baseline - see the top of scripts/live-eval.mjs");
}
