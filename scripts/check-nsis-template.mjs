#!/usr/bin/env node
// Checks that src-tauri/installer/installer.nsi was last synced with the
// tauri-cli version we build with. The file is a vendored copy of the
// bundler's own template, and the bundler's helper macros change with it:
// 1.0.4-rc.1 failed to build on Windows because the CLI had moved to 2.12.3
// while the template was still 2.11.4's. CI does not build the installer,
// so without this check a CLI update stays green until a release tag.
//
// When it fails, run scripts/sync-nsis-template.sh: it merges upstream's
// changes into the file and updates its "Vendored from tauri-cli" line
// (docs/dev/windows-installer.md).
//
//   node scripts/check-nsis-template.mjs     (exit 1 on a mismatch)
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
