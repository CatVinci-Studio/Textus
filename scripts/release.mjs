#!/usr/bin/env node
// Cuts a release: `npm run release -- <version> [--ios] [--resume] [--dry-run]`.
// Bumps the version on a release/<version> branch (a stable one also
// collects its notes and stops for the maintainer to edit them), opens the
// pull request, waits for its CI, squash-merges it, waits for main's run on
// the merge, and tags it. Where it is comes from git and GitHub, so
// --resume carries on from any step; --dry-run prints what it would change.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  bumpFiles,
  compareVersions,
  isStable,
  parseArgs,
  USAGE,
  VERSION_FILES,
} from "./release-bump.mjs";
import { fragmentFiles, unreleasedProblems } from "./release-notes.mjs";

const ownRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

export class Refusal extends Error {}
const refuse = (message) => {
  throw new Refusal(message);
};

const shown = (args) =>
  args
    .map((a) => (/^[\w./:@^{}-]+$/.test(a) ? a : JSON.stringify(a)))
    .join(" ");

/** Reads run always; writes (anything that changes the repository, GitHub
 *  or a file) only print under dry run. */
export function makeShell({ dryRun, exec, say }) {
  const read = (...args) => exec(args).trim();
  return {
    read,
    tryRead: (...args) => {
      try {
        return read(...args);
      } catch {
        return undefined;
      }
    },
    write: (...args) => {
      say(`${dryRun ? "[dry-run] " : ""}$ ${shown(args)}`);
      if (dryRun) return "";
      const out = exec(args).trim();
      if (out) say(out);
      return out;
    },
  };
}

const STAGES = {
  fresh: "not started",
  branch: "bumped on its branch, no pull request yet",
  open: "pull request open",
  merged: "merged, not tagged",
  tagged: "tagged",
  closed: "its pull request was closed without merging",
};

function remoteTag(c, tag) {
  const lines = c.sh.read(
    "git",
    "ls-remote",
    "origin",
    `refs/tags/${tag}`,
    `refs/tags/${tag}^{}`,
  );
  const refs = Object.fromEntries(
    lines
      .split("\n")
      .filter(Boolean)
      .map((l) => l.split("\t").reverse()),
  );
  return refs[`refs/tags/${tag}^{}`] ?? refs[`refs/tags/${tag}`];
}

function findPr(c) {
  const [pr] = JSON.parse(
    c.sh.read(
      "gh",
      "pr",
      "list",
      "--head",
      c.branch,
      "--state",
      "all",
      "--limit",
      "1",
      "--json",
      "number,state,headRefOid,mergeCommit,url,isCrossRepository",
    ) || "[]",
  );
  return pr;
}

function detect(c) {
  c.sh.read("git", "fetch", "--quiet", "origin", "main");
  const tagged = remoteTag(c, c.tag);
  const pr = findPr(c);
  // The script merges what it finds: never a fork's branch of the same name.
  if (pr?.isCrossRepository) refuse(`${pr.url} comes from a fork.`);
  const local = c.sh.tryRead(
    "git",
    "rev-parse",
    "--verify",
    "--quiet",
    `refs/heads/${c.branch}`,
  );
  const stage = tagged
    ? "tagged"
    : pr?.state === "MERGED"
      ? "merged"
      : pr?.state === "OPEN"
        ? "open"
        : pr
          ? "closed"
          : local
            ? "branch"
            : "fresh";
  return { stage, pr, tagged };
}

const readText = (c, file) => readFileSync(join(c.root, file), "utf8");

function writeBump(c) {
  const changed = bumpFiles((file) => readText(c, file), c.version);
  for (const [file, text] of Object.entries(changed)) {
    c.say(`${c.dryRun ? "[dry-run] " : ""}version ${c.version} -> ${file}`);
    if (!c.dryRun) writeFileSync(join(c.root, file), text);
  }
}

const prBody = (c) =>
  c.stable
    ? `Sets the version to ${c.version} and adds the release notes (${c.notes}, reviewed by the maintainer); the fragments in docs/releases/next are folded in. A version bump runs the full CI suite on every platform.`
    : `Sets the version to ${c.version}; a version bump runs the full CI suite on every platform.`;

/** Fresh from main: the branch, the bump and, for a stable version, the
 *  notes. False when it stops for the maintainer to edit them. */
function start(c) {
  c.step("Checking main");
  if (c.sh.read("git", "status", "--porcelain"))
    refuse("The working tree has changes: commit or stash them first.");
  if (
    c.sh.read("git", "rev-parse", "HEAD") !==
    c.sh.read("git", "rev-parse", "origin/main")
  )
    refuse(
      "Check out origin/main first (git switch main && git pull --ff-only).",
    );
  const current = JSON.parse(readText(c, "package.json")).version;
  if (compareVersions(c.version, current) <= 0)
    refuse(`${c.version} is not newer than main's ${current}.`);

  c.step(`Bumping ${current} to ${c.version} on ${c.branch}`);
  c.sh.write("git", "switch", "-c", c.branch);
  writeBump(c);
  if (!c.stable) return true;
  if (c.dryRun)
    c.say(
      `[dry-run] ${fragmentFiles(c.root).length} fragment(s) would go into ${c.notes}`,
    );
  c.sh.write("node", "scripts/release-notes.mjs", "build", c.version);
  if (c.dryRun) {
    c.say("[dry-run] The real run stops here for the notes; after --resume:");
    return true;
  }
  c.say(
    `\nRelease notes: ${join(c.root, c.notes)}\n` +
      "Write the summary sentence, merge bullets that describe one change and order each section. Then:\n" +
      `  npm run release -- ${c.version} --resume${c.ios ? " --ios" : ""}`,
  );
  return false;
}

function commitBump(c) {
  c.step("Committing the bump");
  // Under dry run the branch and its files were only printed.
  const simulated = c.dryRun && c.stage === "fresh";
  if (!simulated && c.sh.read("git", "branch", "--show-current") !== c.branch)
    refuse(`Switch to ${c.branch} first.`);
  if (
    !simulated &&
    c.sh.read("git", "rev-list", "--count", "origin/main..HEAD") !== "0"
  ) {
    c.say("Already committed.");
    return;
  }
  const dirty = [
    c.sh.read("git", "diff", "--name-only", "HEAD"),
    c.sh.read("git", "ls-files", "--others", "--exclude-standard"),
  ]
    .join("\n")
    .split("\n")
    .filter(Boolean);
  const stray = dirty.filter(
    (file) =>
      !VERSION_FILES.includes(file) && !file.startsWith("docs/releases/"),
  );
  if (!simulated && stray.length > 0)
    refuse(`Changes beyond the version and the notes: ${stray.join(", ")}`);
  if (!simulated) writeBump(c);
  if (c.stable) {
    if (!simulated && !existsSync(join(c.root, c.notes)))
      refuse(`${c.notes} is missing: a release needs its notes.`);
    const problems = simulated ? [] : unreleasedProblems(c.root, c.version);
    if (problems.length > 0)
      refuse(`The notes aren't ready:\n  ${problems.join("\n  ")}`);
    c.sh.write("npx", "prettier", "--write", c.notes);
  }
  c.sh.write("git", "add", "--", ...VERSION_FILES, "docs/releases");
  c.sh.write("git", "commit", "--quiet", "-m", c.title);
}

function openPr(c) {
  commitBump(c);
  c.step("Opening the pull request");
  c.sh.write("git", "push", "--quiet", "-u", "origin", c.branch);
  c.sh.write(
    "gh",
    "pr",
    "create",
    "--base",
    "main",
    "--head",
    c.branch,
    "--title",
    c.title,
    "--body",
    prBody(c),
  );
  return c.dryRun
    ? { number: "<pr>", headRefOid: "<head>", url: "<pr>" }
    : findPr(c);
}

/** Waits for ci.yml's `event` run on `sha`; refuses unless it passes. */
async function waitForCi(c, sha, event) {
  if (c.dryRun) {
    c.say(
      `[dry-run] would wait for CI's ${event} run on ${sha} and stop unless it passes`,
    );
    return;
  }
  let last;
  for (;;) {
    const [run] = JSON.parse(
      c.sh.read(
        "gh",
        "run",
        "list",
        "--workflow",
        "ci.yml",
        "--commit",
        sha,
        "--event",
        event,
        "--limit",
        "1",
        "--json",
        "databaseId,status,conclusion,url",
      ) || "[]",
    );
    if (run?.status === "completed") {
      if (run.conclusion === "success") return c.say(`CI passed: ${run.url}`);
      refuse(
        `CI ${run.conclusion}: ${run.url}\n` +
          `Fix it, or rerun a flaky job (gh run rerun ${run.databaseId} --failed), then:\n` +
          `  npm run release -- ${c.version} --resume${c.ios ? " --ios" : ""}`,
      );
    }
    const now = run ? `CI running: ${run.url}` : "Waiting for CI to start";
    if (now !== last) c.say(now);
    last = now;
    await c.sleep(60_000);
  }
}

async function mergePr(c, pr) {
  c.step(`Waiting for CI on ${pr.url}`);
  await waitForCi(c, pr.headRefOid, "pull_request");
  // The tag skips the full suite only when the merge's tree is the one it
  // tested, which a main that moved on breaks.
  if (
    !c.dryRun &&
    c.sh.tryRead(
      "git",
      "merge-base",
      "--is-ancestor",
      "origin/main",
      pr.headRefOid,
    ) === undefined
  )
    c.say(
      `Note: main moved on since ${c.branch} was cut, so the tag will run the full suite again. ` +
        "To avoid that, merge origin/main into the branch, push it and --resume.",
    );
  c.step("Merging");
  c.sh.write(
    "gh",
    "pr",
    "merge",
    String(pr.number),
    "--squash",
    "--match-head-commit",
    pr.headRefOid,
    "--subject",
    `${c.title} (#${pr.number})`,
    "--body",
    prBody(c),
  );
  return c.dryRun ? { ...pr, mergeCommit: { oid: "<merge>" } } : findPr(c);
}

function checkVersionsAt(c, sha) {
  if (c.dryRun)
    return c.say(`[dry-run] would check the version files at ${sha}`);
  c.sh.read("git", "fetch", "--quiet", "origin", "main");
  if (
    c.sh.tryRead("git", "merge-base", "--is-ancestor", sha, "origin/main") ===
    undefined
  )
    refuse(`${sha} is not on main.`);
  const dir = join(mkdtempSync(join(tmpdir(), "textus-release-")), "tree");
  c.sh.read("git", "worktree", "add", "--quiet", "--detach", dir, sha);
  try {
    c.sh.read(
      "node",
      join(c.root, "scripts/check-versions.mjs"),
      "--root",
      dir,
      "--tag",
      c.tag,
    );
  } catch (error) {
    refuse(
      `${sha} can't be tagged ${c.tag}:\n${error.stderr ?? error.message}`,
    );
  } finally {
    c.sh.read("git", "worktree", "remove", "--force", dir);
  }
}

function pushTag(c, tag, sha, message) {
  if (remoteTag(c, tag)) return c.say(`${tag} is already on GitHub.`);
  const local = c.sh.tryRead(
    "git",
    "rev-parse",
    "--verify",
    "--quiet",
    `refs/tags/${tag}^{commit}`,
  );
  if (local && local !== sha)
    refuse(`A local ${tag} points at ${local}, not ${sha}.`);
  if (!local) c.sh.write("git", "tag", "-a", tag, sha, "-m", message);
  c.sh.write("git", "push", "--quiet", "origin", tag);
}

async function tag(c, pr) {
  const sha = pr.mergeCommit.oid;
  c.step(`Checking ${sha}`);
  checkVersionsAt(c, sha);
  // main's own run, which release.yml asks for before it skips the suite.
  await waitForCi(c, sha, "push");
  c.step(`Tagging ${c.tag}`);
  pushTag(c, c.tag, sha, c.title);
  return sha;
}

/** Carries the release on from wherever it is. */
export async function release(c) {
  const found = detect(c);
  let { stage, pr, tagged } = found;
  c.stage = stage;
  c.say(`Textus ${c.version}: ${STAGES[stage]}${pr ? ` (${pr.url})` : ""}`);
  if (stage === "closed")
    refuse(
      `Delete the branch ${c.branch}, here and on GitHub, to start again.`,
    );
  if (stage !== "fresh" && !c.resume)
    refuse("Rerun with --resume to carry on.");
  if (stage === "fresh" && c.resume)
    refuse("Nothing to resume: run without --resume.");
  if (stage === "fresh" && !start(c)) return;
  if (stage === "fresh" || stage === "branch") pr = openPr(c);
  if (stage !== "merged" && stage !== "tagged") pr = await mergePr(c, pr);
  if (stage !== "tagged") tagged = await tag(c, pr);
  if (c.ios) {
    c.step(`Tagging ios-${c.tag}`);
    pushTag(c, `ios-${c.tag}`, tagged, `${c.title} for iOS`);
  }
  c.step("Done");
  c.say(
    `${c.tag} is pushed; release.yml builds it (gh run list --workflow release.yml).` +
      `\nThe local branch can go: git branch -D ${c.branch}`,
  );
}

export function context(
  opts,
  { root = ownRoot, exec, say = console.log, sleep } = {},
) {
  return {
    ...opts,
    root,
    say,
    step: (title) => say(`\n== ${title}`),
    sleep: sleep ?? ((ms) => new Promise((done) => setTimeout(done, ms))),
    sh: makeShell({ dryRun: opts.dryRun, exec, say }),
    stable: isStable(opts.version),
    tag: `v${opts.version}`,
    branch: `release/${opts.version}`,
    title: `Textus ${opts.version}`,
    notes: `docs/releases/${opts.version}.md`,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`${error.message}\n${USAGE}`);
    process.exit(2);
  }
  const exec = ([cmd, ...args]) =>
    execFileSync(cmd, args, {
      cwd: ownRoot,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  release(context(opts, { exec })).catch((error) => {
    if (!(error instanceof Refusal) && error.stderr === undefined) throw error;
    console.error(`\nStopped: ${error.message}`);
    process.exit(1);
  });
}
