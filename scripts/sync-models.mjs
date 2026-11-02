#!/usr/bin/env node
// Refreshes the models snapshot and the built-in model capabilities from
// models.dev, and fails when a pinned model disappeared or was deprecated.
// Which models to pin stays a human decision; models.dev is too noisy.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SNAPSHOT = join(ROOT, "src/ai/models-snapshot.json");
const CAPABILITIES = join(
  ROOT,
  "src-tauri/crates/aicompat/data/model-capabilities.json",
);
const RUST_CATALOG = join(ROOT, "src-tauri/src/ai/catalog.rs");
const TS_CATALOG = join(ROOT, "src/ai/provider-catalog.ts");
const SOURCE = "https://models.dev/api.json";

// Catalog provider id -> models.dev provider id. Moonshot and Qwen map to
// the China endpoints the catalog calls. Every catalog entry must be here or
// in UNMAPPED.
const PROVIDERS = {
  openai: "openai",
  anthropic: "anthropic",
  google: "google",
  deepseek: "deepseek",
  xai: "xai",
  mistral: "mistral",
  groq: "groq",
  moonshot: "moonshotai-cn",
  zhipu: "zhipuai",
  qwen: "alibaba-cn",
  doubao: "volcengine",
  minimax: "minimax-cn",
  "minimax-intl": "minimax",
};
const UNMAPPED = ["openrouter", "opencode-go", "ollama", "custom"];

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

/** One provider's text-output models, reduced to what the app can use. */
function pickModels(models) {
  const out = {};
  for (const m of Object.values(models)) {
    const output = m.modalities?.output ?? ["text"];
    if (!output.includes("text")) continue;
    out[m.id] = {
      name: m.name ?? m.id,
      released: m.release_date ?? null,
      tools: m.tool_call === true,
      vision: (m.modalities?.input ?? []).includes("image"),
      context: m.limit?.context ?? null,
      ...(m.status ? { status: m.status } : {}),
    };
  }
  return sortKeys(out);
}

/** What a model's thinking can be told to do: `false` when it doesn't
 *  reason, `true` when it takes no setting, else its toggle/effort/budget. */
function reasoningOf(m) {
  if (m.reasoning !== true) return false;
  const out = {};
  for (const option of m.reasoning_options ?? []) {
    if (option.type === "toggle") out.toggle = true;
    else if (option.type === "effort" && option.values?.length)
      out.effort = option.values;
    else if (option.type === "budget_tokens") out.budget = option.max ?? true;
  }
  return Object.keys(out).length ? out : true;
}

/** One provider's text-output models' capabilities. */
function pickCapabilities(models) {
  const out = {};
  for (const m of Object.values(models)) {
    const output = m.modalities?.output ?? ["text"];
    if (!output.includes("text")) continue;
    out[m.id] = { reasoning: reasoningOf(m) };
  }
  return sortKeys(out);
}

function sortKeys(object) {
  return Object.fromEntries(
    Object.keys(object)
      .sort()
      .map((k) => [k, object[k]]),
  );
}

/** The models each catalog provider pins, read out of a catalog source
 *  file. Regex over source is crude, but the catalogs are flat literals and
 *  the result is cross-checked: an entry that yields nothing is an error. */
function pinsFromRust(source) {
  const pins = {};
  for (const block of source.split("ProviderCatalogEntry {").slice(2)) {
    const id = /\bid: "([^"]+)"/.exec(block)?.[1];
    if (!id) continue;
    const ids = new Set();
    for (const re of [
      /\bdefault_model: Some\("([^"]+)"\)/,
      /agent_default_model: Some\("([^"]+)"\)/,
    ]) {
      const hit = re.exec(block)?.[1];
      if (hit) ids.add(hit);
    }
    const known = /known_models: &\[([^\]]*)\]/.exec(block)?.[1] ?? "";
    for (const [, model] of known.matchAll(/"([^"]+)"/g)) ids.add(model);
    pins[id] = [...ids];
  }
  return pins;
}

function pinsFromTs(source) {
  const pins = {};
  for (const block of source.split(/\n {2}\{\n/).slice(1)) {
    const id = /\bid: "([^"]+)"/.exec(block)?.[1];
    if (!id) continue;
    const ids = new Set();
    for (const re of [
      /defaultModel: "([^"]+)"/,
      /agentDefaultModel: "([^"]+)"/,
    ]) {
      const hit = re.exec(block)?.[1];
      if (hit) ids.add(hit);
    }
    const known = /knownModels: \[([^\]]*)\]/.exec(block)?.[1] ?? "";
    for (const [, model] of known.matchAll(/"([^"]+)"/g)) ids.add(model);
    pins[id] = [...ids];
  }
  return pins;
}

/** Every pinned model that's missing from, or deprecated in, the snapshot. */
function checkPins(snapshot, pins, label) {
  const problems = [];
  for (const [provider, models] of Object.entries(pins)) {
    if (UNMAPPED.includes(provider)) continue;
    const known = snapshot.providers[provider];
    if (!known) {
      problems.push(
        `${label}: provider \`${provider}\` isn't mapped in scripts/sync-models.mjs`,
      );
      continue;
    }
    for (const model of models) {
      const entry = known.models[model];
      if (!entry)
        problems.push(`${label}: \`${provider}/${model}\` is no longer listed`);
      else if (entry.status === "deprecated")
        problems.push(`${label}: \`${provider}/${model}\` is deprecated`);
    }
  }
  return problems;
}

function diff(before, after) {
  const lines = [];
  for (const [provider, { models }] of Object.entries(after.providers)) {
    const old = before?.providers?.[provider]?.models ?? {};
    // Newest first; a model that arrives already deprecated isn't news.
    const added = Object.keys(models)
      .filter((id) => !old[id] && models[id].status !== "deprecated")
      .sort((a, b) =>
        (models[b].released ?? "").localeCompare(models[a].released ?? ""),
      );
    const removed = Object.keys(old).filter((id) => !models[id]);
    const deprecated = Object.keys(models).filter(
      (id) =>
        models[id].status === "deprecated" &&
        old[id] &&
        old[id].status !== "deprecated",
    );
    if (!added.length && !removed.length && !deprecated.length) continue;
    lines.push(`### ${provider}`);
    for (const id of added) {
      const m = models[id];
      const tags = [
        m.released,
        m.tools ? "tools" : "no tools",
        m.vision ? "vision" : null,
        m.status,
      ]
        .filter(Boolean)
        .join(", ");
      lines.push(`- added \`${id}\` (${tags})`);
    }
    for (const id of deprecated) lines.push(`- deprecated \`${id}\``);
    for (const id of removed) lines.push(`- removed \`${id}\``);
    lines.push("");
  }
  return lines;
}

async function main() {
  const input = arg("--input");
  const api = input
    ? JSON.parse(readFileSync(input, "utf8"))
    : await fetch(SOURCE).then((res) => {
        if (!res.ok) throw new Error(`${SOURCE}: HTTP ${res.status}`);
        return res.json();
      });

  let before = null;
  try {
    before = JSON.parse(readFileSync(SNAPSHOT, "utf8"));
  } catch {
    // First run: everything is "added".
  }

  const providers = {};
  const capabilities = {};
  for (const [ours, theirs] of Object.entries(PROVIDERS)) {
    const entry = api[theirs];
    if (!entry)
      throw new Error(
        `models.dev has no provider \`${theirs}\` (for \`${ours}\`)`,
      );
    providers[ours] = {
      modelsDev: theirs,
      models: pickModels(entry.models ?? {}),
    };
    capabilities[ours] = pickCapabilities(entry.models ?? {});
  }
  let beforeCapabilities = null;
  try {
    beforeCapabilities = JSON.parse(readFileSync(CAPABILITIES, "utf8"));
  } catch {
    // First run.
  }
  const capabilitiesChanged =
    JSON.stringify(capabilities) !==
    JSON.stringify(beforeCapabilities?.providers);
  const changed =
    JSON.stringify(providers) !== JSON.stringify(before?.providers);
  const snapshot = {
    $comment:
      "Generated by scripts/sync-models.mjs from models.dev - do not edit by hand. `updated` is the date the data last changed.",
    source: SOURCE,
    updated: changed ? today() : (before?.updated ?? today()),
    unmapped: UNMAPPED,
    providers,
  };

  const rustPins = pinsFromRust(readFileSync(RUST_CATALOG, "utf8"));
  const tsPins = pinsFromTs(readFileSync(TS_CATALOG, "utf8"));
  if (Object.keys(rustPins).length < Object.keys(PROVIDERS).length)
    throw new Error("Couldn't read the provider entries out of catalog.rs");
  const problems = [
    ...checkPins(snapshot, rustPins, "catalog.rs"),
    ...checkPins(snapshot, tsPins, "provider-catalog.ts"),
  ];

  const report = [
    `Model data from [models.dev](https://models.dev), snapshot dated **${snapshot.updated}**.`,
    "",
    problems.length
      ? "## ⚠️ Pinned models that need attention\n\n" +
        problems.map((p) => `- ${p}`).join("\n") +
        "\n\nUpdate the defaults / known_models in `src-tauri/src/ai/catalog.rs` and `src/ai/provider-catalog.ts`, then push to this branch."
      : "## Pinned models\n\nEvery default and known model in the catalog is still listed and not deprecated.",
    "",
    "## What changed upstream",
    "",
    ...(changed
      ? diff(before, snapshot)
      : ["Nothing since the last snapshot."]),
    "Worth a look when a new model is added for a provider: is it a better default or agent model than the pinned one?",
  ].join("\n");

  const reportPath = arg("--report");
  if (reportPath) writeFileSync(reportPath, report + "\n");
  console.log(report);

  if (process.argv.includes("--check")) {
    if (changed || capabilitiesChanged)
      console.error(
        "\nmodels-snapshot.json or model-capabilities.json is out of date - run scripts/sync-models.mjs",
      );
    process.exit(changed || capabilitiesChanged || problems.length ? 1 : 0);
  }
  if (changed)
    writeFileSync(SNAPSHOT, JSON.stringify(snapshot, null, 2) + "\n");
  if (capabilitiesChanged)
    writeFileSync(
      CAPABILITIES,
      JSON.stringify(
        {
          $comment:
            "Generated by scripts/sync-models.mjs from models.dev - do not edit by hand. Read by aicompat/src/capabilities.rs.",
          source: SOURCE,
          providers: capabilities,
        },
        null,
        2,
      ) + "\n",
    );
  process.exit(problems.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(2);
});
