/** Ship the pinned official SDK and the Node binary used to validate it. */
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import {
  ensureDependencies,
  runtimeTarget,
  stageNode,
} from "./harness-build.mjs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
const root = resolve("harness");
const dest = resolve("src-tauri/resources/harness");
const target = runtimeTarget(
  process.env.TAURI_ENV_TARGET_TRIPLE || process.env.CARGO_BUILD_TARGET,
);
if (target.platform === "ios") process.exit(0);
await ensureDependencies(root);
await mkdir(dest, { recursive: true });
const manifest = JSON.parse(
  await readFile(
    root + "/node_modules/@deepseek-ai/dsh-sdk-client/package.json",
    "utf8",
  ),
);
if (manifest.version !== "0.2.1-rc.2")
  throw new Error(
    "Unexpected Harness SDK version; run npm ci --prefix harness",
  );
for (const file of [
  "host.mjs",
  "cli.mjs",
  "protocol.mjs",
  "document-tools.mjs",
  "package.json",
  "package-lock.json",
  "LICENSE.deepseek",
])
  await cp(root + "/" + file, dest + "/" + file);
const fingerprint = createHash("sha256")
  .update(await readFile(root + "/package-lock.json"))
  .update(JSON.stringify(target))
  .digest("hex");
let previous;
try {
  previous = JSON.parse(await readFile(dest + "/BUILD.json", "utf8"));
} catch {
  /* first build */
}
if (previous?.fingerprint !== fingerprint) {
  if (target.arch === process.arch && target.platform === process.platform)
    await cp(root + "/node_modules", dest + "/node_modules", {
      recursive: true,
      dereference: true,
    });
  else
    execFileSync(
      process.platform === "win32" ? "npm.cmd" : "npm",
      [
        "ci",
        "--prefix",
        dest,
        "--cpu=" + target.arch,
        "--os=" + target.platform,
        "--no-audit",
        "--no-fund",
      ],
      {
        stdio: "inherit",
        env: {
          ...process.env,
          npm_config_arch: target.arch,
          npm_config_platform: target.platform,
        },
        shell: process.platform === "win32",
      },
    );
}
const nodeVersion = await stageNode(dest, target);
await writeFile(
  dest + "/BUILD.json",
  JSON.stringify({
    harness: manifest.version,
    node: nodeVersion,
    platform: target.platform,
    arch: target.arch,
    fingerprint,
  }),
);
console.log(
  "Prepared official Harness runtime and Node:",
  manifest.version,
  process.version,
  process.arch,
);
