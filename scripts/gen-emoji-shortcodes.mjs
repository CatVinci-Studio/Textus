// Writes src/editor/emoji/shortcodes.json, GitHub's `:shortcode:` names
// (from gemoji) to their emoji: the editor loads it on first use, so the
// app carries the names without gemoji's descriptions and tags.
//
//   node scripts/gen-emoji-shortcodes.mjs
import { writeFileSync } from "node:fs";
import { gemoji } from "gemoji";

const table = {};
for (const { emoji, names } of gemoji)
  for (const name of names) table[name] ??= emoji;

const path = new URL("../src/editor/emoji/shortcodes.json", import.meta.url);
// Indented as Prettier writes it, so the check passes; the bundle minifies it.
writeFileSync(path, `${JSON.stringify(table, null, 2)}\n`);
console.log(`${Object.keys(table).length} shortcodes`);
