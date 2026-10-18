#!/usr/bin/env node
// Which installer the website's download buttons get under which key: the
// manifest.json that scripts/mirror-downloads.sh puts in the download bucket
// (textus-downloads). The site (CatVinci-Studio/levis-homepage) reads it
// through functions/download/[[path]].js, so a key, once there, stays.
//
//   node scripts/mirror-keys.mjs --tag vX.Y.Z --out FILE FILE...
//       writes the manifest for the files given (any path; only the name
//       counts) to FILE; names that are no installer are left out
import { writeFileSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";

/** Each key and the installer it serves, by tauri-bundler's name for it, in
 *  the manifest's order. The x64 keys came first and keep their names;
 *  ARM64 Windows and Linux (from 1.1.0) end in -arm64. */
export const MIRROR_KEYS = [
  ["mac", /_aarch64\.dmg$/],
  ["mac-intel", /_x64\.dmg$/],
  ["windows", /_x64-setup\.exe$/],
  ["linux", /_amd64\.AppImage$/],
  ["deb", /_amd64\.deb$/],
  ["rpm", /\.x86_64\.rpm$/],
  ["windows-arm64", /_arm64-setup\.exe$/],
  ["linux-arm64", /_aarch64\.AppImage$/],
  ["deb-arm64", /_arm64\.deb$/],
  ["rpm-arm64", /\.aarch64\.rpm$/],
];

/** The key a release asset is mirrored under, or null for any other file. */
export function mirrorKey(name) {
  return MIRROR_KEYS.find(([, pattern]) => pattern.test(name))?.[0] ?? null;
}

/** The manifest.json for a release's mirrored `names`: each key's object
 *  path in the bucket. */
export function mirrorManifest(tag, names) {
  const byKey = {};
  for (const name of names) {
    const key = mirrorKey(name);
    if (key === null) continue;
    if (byKey[key])
      throw new Error(`${byKey[key]} and ${name} are both ${key}`);
    byKey[key] = name;
  }
  const files = {};
  for (const [key] of MIRROR_KEYS)
    if (byKey[key]) files[key] = `releases/${tag}/${byKey[key]}`;
  return { tag, version: tag.replace(/^v/, ""), files };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const take = (flag) => {
    const at = args.indexOf(flag);
    if (at < 0 || !args[at + 1]) {
      console.error(`::error::${flag} is required`);
      process.exit(1);
    }
    return args.splice(at, 2)[1];
  };
  const tag = take("--tag");
  const out = take("--out");
  const manifest = mirrorManifest(
    tag,
    args.map((path) => basename(path)),
  );
  writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
}
