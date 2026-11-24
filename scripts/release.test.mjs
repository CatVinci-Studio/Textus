import { describe, expect, it } from "vitest";
import { context, makeShell, release } from "./release.mjs";

/** Answers the read-only calls of a release not yet started from a clean
 *  main; any other call fails the test. */
function freshMain(calls) {
  return (args) => {
    calls.push(args);
    const line = args.join(" ");
    if (line.startsWith("git fetch")) return "";
    if (line.startsWith("git ls-remote")) return "";
    if (line.startsWith("gh pr list")) return "[]";
    if (line.startsWith("git rev-parse --verify")) throw new Error("no ref");
    if (line === "git status --porcelain") return "";
    if (line === "git rev-parse HEAD" || line === "git rev-parse origin/main")
      return "abc123";
    if (
      line.startsWith("git diff --name-only") ||
      line.startsWith("git ls-files")
    )
      return "";
    throw new Error(`unexpected call: ${line}`);
  };
}

describe("release dry run", () => {
  it("never runs a write", () => {
    const run = [];
    const sh = makeShell({
      dryRun: true,
      exec: (args) => {
        run.push(args);
        return "";
      },
      say: () => {},
    });
    sh.write("git", "push", "origin", "v1.0.0");
    expect(run).toEqual([]);
    sh.read("git", "status");
    expect(run).toEqual([["git", "status"]]);
  });

  it("walks a stable release from main to its tags, reading only", async () => {
    const calls = [];
    const said = [];
    const c = context(
      { version: "99.0.0", ios: true, resume: false, dryRun: true },
      {
        exec: freshMain(calls),
        say: (line) => said.push(line),
        sleep: async () => {},
      },
    );
    await release(c);
    const writes = said
      .filter((line) => line.startsWith("[dry-run] $ "))
      .map((line) =>
        line.slice("[dry-run] $ ".length).split(" ").slice(0, 3).join(" "),
      );
    expect(writes).toEqual([
      "git switch -c",
      "node scripts/release-notes.mjs build",
      "npx prettier --write",
      "git add --",
      "git commit --quiet",
      "git push --quiet",
      "gh pr create",
      "gh pr merge",
      "git tag -a",
      "git push --quiet",
      "git tag -a",
      "git push --quiet",
    ]);
    expect(said).toContain("[dry-run] version 99.0.0 -> package.json");
    expect(
      said.some((line) =>
        line.includes("would wait for CI's pull_request run"),
      ),
    ).toBe(true);
    expect(
      said.some((line) => line.includes("would wait for CI's push run")),
    ).toBe(true);
    const reads =
      /^(git (fetch|ls-remote|rev-parse|status|diff|ls-files)|gh pr list) /;
    for (const args of calls) expect(`${args.join(" ")} `).toMatch(reads);
  });

  it("commits a test build's bump without notes", async () => {
    const said = [];
    const c = context(
      { version: "99.0.0-rc.1", ios: false, resume: false, dryRun: true },
      { exec: freshMain([]), say: (line) => said.push(line) },
    );
    await release(c);
    expect(said.filter((line) => /notes|prettier/.test(line))).toEqual([]);
    expect(said).toContain(
      '[dry-run] $ git commit --quiet -m "Textus 99.0.0-rc.1"',
    );
    expect(said).toContain(
      '[dry-run] $ git tag -a v99.0.0-rc.1 "<merge>" -m "Textus 99.0.0-rc.1"',
    );
  });

  it("refuses a version that is not newer than main's", async () => {
    const c = context(
      { version: "0.0.1", ios: false, resume: false, dryRun: true },
      { exec: freshMain([]), say: () => {} },
    );
    await expect(release(c)).rejects.toThrow("not newer");
  });

  it("refuses --resume when nothing is under way", async () => {
    const c = context(
      { version: "99.0.0", ios: false, resume: true, dryRun: true },
      { exec: freshMain([]), say: () => {} },
    );
    await expect(release(c)).rejects.toThrow("Nothing to resume");
  });
});

/** A release whose pull request is open: `runs` are the successive answers
 *  about its CI run; after `gh pr merge` the pull request reads as merged. */
function openPr(calls, runs) {
  let merged = false;
  return (args) => {
    calls.push(args);
    const line = args.join(" ");
    if (line.startsWith("gh pr list")) {
      const state = merged ? "MERGED" : "OPEN";
      return JSON.stringify([
        {
          number: 7,
          state,
          headRefOid: "head",
          mergeCommit: merged ? { oid: "merge" } : null,
          url: "pr/7",
        },
      ]);
    }
    if (line.startsWith("gh pr merge")) merged = true;
    if (line.startsWith("gh run list --workflow ci.yml --commit head"))
      return JSON.stringify([runs.shift()]);
    if (line.startsWith("gh run list"))
      return JSON.stringify([
        { status: "completed", conclusion: "success", url: "main-run" },
      ]);
    if (line.startsWith("git rev-parse --verify")) throw new Error("no ref");
    return "";
  };
}

describe("release from an open pull request", () => {
  const resume = { version: "99.0.0", ios: false, resume: true, dryRun: false };

  it("waits for CI, merges that head and tags the merge", async () => {
    const calls = [];
    const c = context(resume, {
      exec: openPr(calls, [
        { status: "in_progress", url: "run" },
        { status: "completed", conclusion: "success", url: "run" },
      ]),
      say: () => {},
      sleep: async () => {},
    });
    await release(c);
    const lines = calls.map((args) => args.join(" "));
    const merge = lines.findIndex((line) =>
      line.startsWith("gh pr merge 7 --squash --match-head-commit head "),
    );
    const tag = lines.indexOf("git tag -a v99.0.0 merge -m Textus 99.0.0");
    expect(merge).toBeGreaterThan(0);
    expect(tag).toBeGreaterThan(merge);
    expect(lines).toContain("git push --quiet origin v99.0.0");
  });

  it.each(["failure", "cancelled"])(
    "stops without merging when CI ends %s",
    async (conclusion) => {
      const calls = [];
      const c = context(resume, {
        exec: openPr(calls, [
          { status: "completed", conclusion, url: "run", databaseId: 3 },
        ]),
        say: () => {},
        sleep: async () => {},
      });
      await expect(release(c)).rejects.toThrow(`CI ${conclusion}`);
      expect(
        calls.some((args) => args[0] === "gh" && args[2] === "merge"),
      ).toBe(false);
      expect(calls.some((args) => args[1] === "tag")).toBe(false);
    },
  );
});
