#!/usr/bin/env node
// Whether a tag's commit already passed CI, so release.yml need not run the
// full suite on it again: main's own run on that commit passed, and so did
// a full-suite run (the version bump's pull request) on exactly its tree.
// Prints `passed=true|false` for $GITHUB_OUTPUT; any doubt is `false`.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** Jobs only the full suite has, beside the required checks. */
export const FULL_SUITE_JOBS = [
  "check",
  "e2e",
  "native",
  "native (macos-26)",
  "native (windows-2025)",
];

const passed = (run) =>
  run.status === "completed" && run.conclusion === "success";

/** Why `runs` (ci.yml's, from the API) and `jobsOf(runId)` show the commit
 *  `sha` with tree `tree` as tested, or `undefined` when they don't. */
export function testedReason({ repo, sha, tree, runs, jobsOf }) {
  const onMain = runs.find(
    (run) =>
      run.event === "push" &&
      run.head_branch === "main" &&
      run.head_sha === sha &&
      passed(run),
  );
  if (!onMain) return undefined;
  const full = runs.find(
    (run) =>
      run.event === "pull_request" &&
      run.head_repository?.full_name === repo &&
      run.head_commit?.tree_id === tree &&
      passed(run) &&
      FULL_SUITE_JOBS.every((name) =>
        jobsOf(run.id).some(
          (job) => job.name === name && job.conclusion === "success",
        ),
      ),
  );
  if (!full) return undefined;
  return `main's run ${onMain.html_url} and the full suite ${full.html_url} passed on this tree`;
}

function api(path) {
  return JSON.parse(
    execFileSync("gh", ["api", path], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    }),
  );
}

function main(argv) {
  const option = (name) => argv[argv.indexOf(name) + 1];
  const repo = option("--repo");
  const ref = option("--ref");
  const jobs = new Map();
  let reason;
  try {
    const commit = api(`repos/${repo}/commits/${ref}`);
    const list = (query) =>
      api(`repos/${repo}/actions/workflows/ci.yml/runs?per_page=100&${query}`)
        .workflow_runs;
    reason = testedReason({
      repo,
      sha: commit.sha,
      tree: commit.commit.tree.sha,
      runs: [
        ...list(`event=push&head_sha=${commit.sha}`),
        ...list("event=pull_request&status=success"),
      ],
      jobsOf: (id) => {
        if (!jobs.has(id))
          jobs.set(
            id,
            api(`repos/${repo}/actions/runs/${id}/jobs?per_page=100`).jobs,
          );
        return jobs.get(id);
      },
    });
  } catch (error) {
    console.error(`Couldn't ask GitHub: ${error.message}`);
  }
  console.error(
    reason
      ? `CI already passed: ${reason}.`
      : "No passing full-suite run on this commit's tree: running CI.",
  );
  console.log(`passed=${Boolean(reason)}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
