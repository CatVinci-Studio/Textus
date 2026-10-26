#!/usr/bin/env node
// Checks the vendored installer.nsi was synced with the tauri-cli we build
// with: its macros change with the CLI, and CI doesn't build the installer.
// On failure, run scripts/sync-nsis-template.sh.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(join(root, file), "utf8");

const lock = JSON.parse(read("package-lock.json"));
const cli = lock.packages?.["node_modules/@tauri-apps/cli"]?.version;
const vendored = read("src-tauri/installer/installer.nsi").match(
  /^; Vendored from tauri-cli v(\S+?):?$/m,
)?.[1];

if (!cli || !vendored) {
  console.error(
    !cli
      ? "check-nsis-template: @tauri-apps/cli is not in package-lock.json"
      : 'check-nsis-template: no "; Vendored from tauri-cli vX.Y.Z:" line in src-tauri/installer/installer.nsi',
  );
  process.exit(1);
}
if (cli !== vendored) {
  console.error(
    `The Windows installer template is from tauri-cli ${vendored}, but we build with ${cli}.\n` +
      "Run scripts/sync-nsis-template.sh to merge that version's template into " +
      "src-tauri/installer/installer.nsi (docs/dev/windows-installer.md).",
  );
  process.exit(1);
}
