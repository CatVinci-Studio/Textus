// The plugin API reference (docs/dev/plugin-reference.md), made from
// docs/dev/textus.d.ts - the one source of truth for the API - so the two
// never disagree. Every interface and type of the Textus namespace in the
// order the file has them, each member with its signature and its comment.
//   node scripts/plugin-reference.mjs          writes the page
//   node scripts/plugin-reference.mjs --check  fails when it is out of date
// (src/plugins/plugin-reference.test.ts runs the check with the unit tests.)

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as prettier from "prettier";
import ts from "typescript";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(root, "docs/dev/textus.d.ts");
const PAGE = join(root, "docs/dev/plugin-reference.md");

/** A node's /** comment *\/, as plain lines. */
function commentOf(node, text) {
  const ranges = ts.getLeadingCommentRanges(text, node.pos) ?? [];
  const doc = ranges
    .map((r) => text.slice(r.pos, r.end))
    .filter((c) => c.startsWith("/**"))
    .pop();
  if (!doc) return "";
  // Lines run together into paragraphs; a line starting "- " starts an
  // item of a list, and an empty line a new paragraph.
  const parts = [];
  for (const raw of doc
    .replace(/^\/\*\*\s?/, "")
    .replace(/\s*\*\/$/, "")
    .split("\n")) {
    const line = raw.replace(/^\s*\* ?/, "").trim();
    if (!line) parts.push("");
    else if (line.startsWith("- ") || !parts.length || parts.at(-1) === "")
      parts.push(line);
    else parts[parts.length - 1] += " " + line;
  }
  return parts
    .join("\n")
    .replace(/\n{2,}/g, "\n\n")
    .replace(/([^\n])\n- /g, "$1\n\n- ")
    .trim();
}

/** A comment in a table's cell: one line. */
const inCell = (comment) =>
  comment.replace(/\s*\n+\s*/g, " ").replace(/\|/g, "\\|");

/** A member's signature, on one line. */
function signature(node, text) {
  return text
    .slice(node.getStart(), node.end)
    .replace(/\/\*\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ")
    .replace(/\(\s/g, "(")
    .replace(/\s\)/g, ")")
    .replace(/,\s*\)/g, ")")
    .replace(/;$/, "")
    .trim();
}

export async function reference() {
  const text = readFileSync(SOURCE, "utf8");
  const file = ts.createSourceFile(SOURCE, text, ts.ScriptTarget.Latest, true);
  const out = [
    "# Plugin API reference",
    "",
    "Made from [textus.d.ts](textus.d.ts) by `scripts/plugin-reference.mjs` -",
    "change that file, then run the script; don't edit this page. How the",
    "parts fit together is in [Writing a plugin](writing-plugins.md).",
    "",
    "`textus` is a `Textus.Api`; `activate` is given a `PluginContext`;",
    "a webview's page has `acquireTextusApi()`, a `WebviewApi`.",
    "",
  ];
  const visit = (node) => {
    if (ts.isModuleDeclaration(node) && node.name.text === "Textus") {
      for (const item of node.body.statements) {
        if (ts.isInterfaceDeclaration(item)) {
          out.push(`## ${item.name.text}`, "");
          const about = commentOf(item, text);
          if (about) out.push(about, "");
          const members = item.members.filter((m) => m.name);
          if (members.length) {
            out.push("| Member | |", "| --- | --- |");
            for (const m of members) {
              const sig = signature(m, text).replace(/\|/g, "\\|");
              out.push(`| \`${sig}\` | ${inCell(commentOf(m, text))} |`);
            }
            out.push("");
          }
        } else if (ts.isTypeAliasDeclaration(item)) {
          out.push(`## ${item.name.text}`, "");
          const about = commentOf(item, text);
          if (about) out.push(about, "");
          out.push("```ts", signature(item, text), "```", "");
        }
      }
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  // As the formatter writes it, so `npm run format` leaves it alone.
  const options = (await prettier.resolveConfig(PAGE)) ?? {};
  return prettier.format(out.join("\n"), { ...options, parser: "markdown" });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const page = await reference();
  if (process.argv.includes("--check")) {
    if (readFileSync(PAGE, "utf8") !== page) {
      console.error(
        "docs/dev/plugin-reference.md is out of date: run node scripts/plugin-reference.mjs",
      );
      process.exit(1);
    }
  } else {
    writeFileSync(PAGE, page);
    console.log("wrote docs/dev/plugin-reference.md");
  }
}
