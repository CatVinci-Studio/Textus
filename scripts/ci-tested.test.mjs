import { describe, expect, it } from "vitest";
import { FULL_SUITE_JOBS, testedReason } from "./ci-tested.mjs";

const repo = "owner/textus";
const done = { status: "completed", conclusion: "success" };
const onMain = {
  ...done,
  id: 1,
  event: "push",
  head_branch: "main",
  head_sha: "merge",
  html_url: "main-run",
};
const bumpPr = {
  ...done,
  id: 2,
  event: "pull_request",
  head_sha: "head",
  head_repository: { full_name: repo },
  head_commit: { tree_id: "tree" },
  html_url: "pr-run",
};
const full = FULL_SUITE_JOBS.map((name) => ({ name, conclusion: "success" }));
// A pull request's quick run: the required checks, no macOS or Windows.
const quick = full.filter((job) => !job.name.includes("("));

const reason = (runs, jobs = { 2: full }) =>
  testedReason({
    repo,
    sha: "merge",
    tree: "tree",
    runs,
    jobsOf: (id) => jobs[id] ?? [],
  });

describe("ci-tested", () => {
  it("passes main's run plus a full-suite run on the same tree", () => {
    expect(reason([onMain, bumpPr])).toContain("pr-run");
  });

  it("asks for both runs", () => {
    expect(reason([bumpPr])).toBeUndefined();
    expect(reason([onMain])).toBeUndefined();
    expect(
      reason([{ ...onMain, conclusion: "failure" }, bumpPr]),
    ).toBeUndefined();
  });

  it("refuses a quick run, another tree, or a fork's run", () => {
    expect(reason([onMain, bumpPr], { 2: quick })).toBeUndefined();
    expect(
      reason([onMain, { ...bumpPr, head_commit: { tree_id: "other" } }]),
    ).toBeUndefined();
    expect(
      reason([
        onMain,
        { ...bumpPr, head_repository: { full_name: "fork/textus" } },
      ]),
    ).toBeUndefined();
    expect(
      reason([onMain, { ...bumpPr, status: "in_progress", conclusion: null }]),
    ).toBeUndefined();
  });
});
