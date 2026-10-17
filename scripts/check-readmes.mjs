#!/usr/bin/env node
// Checks that every README.<lang>.md still follows README.md section
// by section: the same heading levels in the same order, the same code
// blocks, the same number of table rows and the same link targets (other
// than the language switcher), and that every image they show exists.
// Wording is free; structure drifting is how a translation falls behind.
//
//   node scripts/check-readmes.mjs     (exit 1 on any difference)
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const reference = "README.md";
const translations = [
  "README.zh.md",
  "README.zh-Hant.md",
  "README.ja.md",
  "README.ko.md",
  "README.es.md",
  "README.fr.md",
  "README.de.md",
  "README.ru.md",
  "README.pt.md",
];

function outline(file) {
  const text = readFileSync(join(root, file), "utf8");
  const code = [...text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((m) =>
    // Comments after `#` are translated; the commands are not.
    m[1]
      .split("\n")
      .map((line) => line.replace(/\s+#.*$/, "").trimEnd())
      .join("\n"),
  );
  const prose = text.replace(/```[\s\S]*?```/g, "");
  const headings = [...prose.matchAll(/^(#{2,6}) /gm)].map((m) => m[1]);
  const tableRows = prose.split("\n").filter((l) => l.startsWith("|")).length;
  const links = [...prose.matchAll(/(?:href|src)="([^"]+)"|\]\(([^)]+)\)/g)]
    .map((m) => m[1] ?? m[2])
    // Each README links to the other languages, and shows its own
    // language's screenshots.
    .filter((target) => !/^\.\/README/.test(target))
    .map((target) =>
      target
        .replace(
          /\/readme\/(en|zh|zh-hant|ja|ko|es|fr|de|ru|pt)\//,
          "/readme/*/",
        )
        // Simplified Chinese links the Chinese roadmap; every other
        // language the English one.
        .replace(/^ROADMAP\.zh\.md$/, "ROADMAP.md"),
    );
  const images = [...prose.matchAll(/src="([^"]+\.png)"/g)].map((m) => m[1]);
  return { headings, code, tableRows, links, images };
}

const problems = [];
const ref = outline(reference);
for (const file of [reference, ...translations]) {
  const doc = outline(file);
  for (const image of doc.images)
    if (!existsSync(join(root, image)))
      problems.push(`${file}: image ${image} does not exist`);
  if (file === reference) continue;
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  if (!same(doc.headings, ref.headings))
    problems.push(
      `${file}: headings ${doc.headings.join(" ")} - ${reference} has ${ref.headings.join(" ")}`,
    );
  if (!same(doc.code, ref.code))
    problems.push(`${file}: code blocks differ from ${reference}`);
  if (doc.tableRows !== ref.tableRows)
    problems.push(
      `${file}: ${doc.tableRows} table rows - ${reference} has ${ref.tableRows}`,
    );
  // The same links, in any order: a translation may list them in the order
  // its readers want (the Chinese ones put the QQ and WeChat groups first).
  if (!same([...doc.links].sort(), [...ref.links].sort()))
    problems.push(
      `${file}: links differ from ${reference}:\n  ${doc.links.join("\n  ")}`,
    );
}

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`READMEs in step (${[reference, ...translations].join(", ")})`);
