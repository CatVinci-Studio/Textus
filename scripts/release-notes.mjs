#!/usr/bin/env node
// Release-note fragments: each pull request adds its own file of section
// headings and bullets, so two never conflict. `check` validates them;
// `build` adds their bullets to the version's notes and deletes them.
import { execFileSync } from "node:child_process";
import {
  existsSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ownRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The template's sections, in its order. */
export const SECTIONS = ["New", "Improved", "Fixed", "Platform notes"];

/** Platform notes' bullets, in the template's order of platforms. */
const PLATFORMS = ["macOS", "Windows", "Linux", "iPhone and iPad"];

export const FRAGMENT_DIR = "docs/releases/next";

/** The closing line of every release's notes. */
const CLOSING =
  "Installers for macOS (Apple silicon and Intel), Windows and Linux (x64 and ARM64) are below; the app updates itself.";

/** What `build` writes where the summary sentence goes in a new file; a
 *  stable tag is refused while it is still there. */
export const SUMMARY_PLACEHOLDER = "<one sentence: what this release is about>";

/** The fragment files under `root`, by name. */
export function fragmentFiles(root = ownRoot) {
  const dir = join(root, FRAGMENT_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".md") && name !== "README.md")
    .sort();
}

/** A fragment's bullets by section, and its problems, one line each. A
 *  bullet is a `- ` line and the indented lines that continue it. */
export function parseFragment(text) {
  const sections = {};
  const problems = [];
  // undefined before the first heading; null under a heading that isn't
  // the template's, whose bullets need no complaint of their own.
  let section;
  for (const [index, line] of text.split("\n").entries()) {
    const at = `line ${index + 1}`;
    const heading = line.match(/^#+\s*(.*?)\s*$/);
    const bullets = section ? sections[section] : undefined;
    if (heading) {
      section =
        line.startsWith("### ") && SECTIONS.includes(heading[1])
          ? heading[1]
          : null;
      if (section) sections[section] ??= [];
      else
        problems.push(
          `${at}: "${line}" is not one of ${SECTIONS.map((s) => `### ${s}`).join(", ")}`,
        );
    } else if (section === null) {
      continue;
    } else if (line.startsWith("- ")) {
      if (bullets) bullets.push(line);
      else problems.push(`${at}: a bullet before any section heading`);
    } else if (/^\s+\S/.test(line) && bullets?.length) {
      bullets[bullets.length - 1] += `\n${line}`;
    } else if (line.trim() !== "") {
      problems.push(
        `${at}: only section headings and "- " bullets belong here`,
      );
    }
  }
  if (
    problems.length === 0 &&
    !Object.values(sections).some((bullets) => bullets.length > 0)
  )
    problems.push("no bullets");
  for (const [name, bullets] of Object.entries(sections))
    if (bullets.length === 0) problems.push(`"### ${name}" has no bullets`);
  return { sections, problems };
}

/** Release notes split into the text before the first section, each
 *  section's bullets, and the text after the last one. */
export function parseNotes(text) {
  const lines = text.replace(/\n+$/, "").split("\n");
  const head = [];
  const sections = {};
  const tail = [];
  let section;
  for (const line of lines) {
    const heading = line.match(/^### (.*?)\s*$/);
    if (heading && tail.length === 0) {
      section = heading[1];
      sections[section] ??= [];
    } else if (section === undefined) head.push(line);
    else if (tail.length > 0) tail.push(line);
    else if (line.startsWith("- ")) sections[section].push(line);
    else if (/^\s+\S/.test(line) && sections[section].length)
      sections[section][sections[section].length - 1] += `\n${line}`;
    else if (line.trim() !== "") tail.push(line);
  }
  while (head.length && head[head.length - 1].trim() === "") head.pop();
  return { head: head.join("\n"), sections, tail: tail.join("\n") };
}

function platformRank(bullet) {
  const at = PLATFORMS.findIndex((p) => bullet.startsWith(`- **${p}:**`));
  return at < 0 ? PLATFORMS.length : at;
}

/** `notes` (or undefined) with the fragments' bullets added to their
 *  sections, in the template's order; platform notes stay grouped. */
export function assemble({ version, notes, fragments }) {
  const parsed = notes
    ? parseNotes(notes)
    : {
        head: `## What's new\n\nTextus ${version} ${SUMMARY_PLACEHOLDER}.`,
        sections: {},
        tail: CLOSING,
      };
  const sections = { ...parsed.sections };
  for (const fragment of fragments)
    for (const [name, bullets] of Object.entries(fragment.sections))
      sections[name] = [...(sections[name] ?? []), ...bullets];
  if (sections["Platform notes"])
    sections["Platform notes"] = sections["Platform notes"]
      .map((bullet, index) => ({ bullet, index }))
      .sort(
        (a, b) =>
          platformRank(a.bullet) - platformRank(b.bullet) || a.index - b.index,
      )
      .map(({ bullet }) => bullet);
  const names = [
    ...SECTIONS.filter((name) => sections[name]?.length),
    ...Object.keys(sections).filter(
      (name) => !SECTIONS.includes(name) && sections[name].length,
    ),
  ];
  const parts = [parsed.head];
  for (const name of names)
    parts.push(`### ${name}`, sections[name].join("\n"));
  if (parsed.tail) parts.push(parsed.tail);
  return `${parts.join("\n\n")}\n`;
}

/** When each fragment was first committed (seconds), for ordering; a
 *  fragment git doesn't know yet sorts last, by name. */
function addedAt(root, name) {
  try {
    const out = execFileSync(
      "git",
      [
        "log",
        "--diff-filter=A",
        "--format=%ct",
        "--",
        `${FRAGMENT_DIR}/${name}`,
      ],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    const times = out.split("\n").filter(Boolean).map(Number);
    return times.length ? Math.min(...times) : Infinity;
  } catch {
    return Infinity;
  }
}

/** Problems with every fragment under `root`, one line each. */
export function fragmentProblems(root = ownRoot) {
  return fragmentFiles(root).flatMap((name) =>
    parseFragment(
      readFileSync(join(root, FRAGMENT_DIR, name), "utf8"),
    ).problems.map((problem) => `${FRAGMENT_DIR}/${name}: ${problem}`),
  );
}

/** Why the checkout at `root` isn't ready to be tagged as stable `version`:
 *  fragments that `build` hasn't added to its notes yet, or the summary
 *  placeholder still in them. */
export function unreleasedProblems(root, version) {
  const problems = [];
  const pending = fragmentFiles(root);
  if (pending.length > 0)
    problems.push(
      `${pending.length} release-note fragment(s) in ${FRAGMENT_DIR}/ are not in ` +
        `docs/releases/${version}.md yet - run node scripts/release-notes.mjs build ${version}`,
    );
  const file = join(root, "docs/releases", `${version}.md`);
  if (
    existsSync(file) &&
    readFileSync(file, "utf8").includes(SUMMARY_PLACEHOLDER)
  )
    problems.push(
      `docs/releases/${version}.md still needs its summary sentence`,
    );
  return problems;
}

function build(root, version) {
  const problems = fragmentProblems(root);
  if (problems.length > 0) return { problems };
  const names = fragmentFiles(root)
    .map((name) => ({ name, at: addedAt(root, name) }))
    .sort((a, b) => a.at - b.at || a.name.localeCompare(b.name))
    .map(({ name }) => name);
  const file = join(root, "docs/releases", `${version}.md`);
  const notes = existsSync(file) ? readFileSync(file, "utf8") : undefined;
  const fragments = names.map((name) =>
    parseFragment(readFileSync(join(root, FRAGMENT_DIR, name), "utf8")),
  );
  writeFileSync(file, assemble({ version, notes, fragments }));
  for (const name of names) unlinkSync(join(root, FRAGMENT_DIR, name));
  return { problems: [], file, names };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const rootAt = args.indexOf("--root");
  const root = rootAt >= 0 ? args.splice(rootAt, 2)[1] : ownRoot;
  const [command, versionArg] = args;
  if (command === "check") {
    const problems = fragmentProblems(root);
    if (problems.length > 0) {
      console.error("Release-note fragments that don't follow the format:");
      for (const p of problems) console.error(`  ${p}`);
      console.error(`See ${FRAGMENT_DIR}/README.md.`);
      process.exit(1);
    }
  } else if (command === "build") {
    const version =
      versionArg ??
      JSON.parse(
        readFileSync(join(root, "package.json"), "utf8"),
      ).version.split("-")[0];
    // A slip like "1.3" would name the notes wrongly and still use up the
    // fragments.
    if (!/^\d+\.\d+\.\d+(-beta\.\d+)?$/.test(version)) {
      console.error(`build takes a version like 1.3.3, not "${version}"`);
      process.exit(1);
    }
    const { problems, file, names } = build(root, version);
    if (problems.length > 0) {
      for (const p of problems) console.error(`  ${p}`);
      process.exit(1);
    }
    console.log(
      `Added ${names.length} fragment(s) to ${file}. Read it through: write ` +
        "the summary sentence, merge bullets that describe one change, and " +
        "order each section by what matters most.",
    );
  } else {
    console.error(
      "usage: release-notes.mjs [--root DIR] check | build [X.Y.Z]",
    );
    process.exit(2);
  }
}
