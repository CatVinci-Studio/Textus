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
