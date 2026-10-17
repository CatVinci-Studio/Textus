import { test } from "node:test";
import assert from "node:assert/strict";
import { ensureDependencies, runtimeTarget } from "./harness-build.mjs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
test("Intel cross-build selects Intel Node even on an ARM builder", () => {
  assert.deepEqual(runtimeTarget("x86_64-apple-darwin", "darwin", "arm64"), {
    platform: "darwin",
    arch: "x64",
  });
  assert.deepEqual(runtimeTarget("aarch64-apple-darwin", "darwin", "x64"), {
    platform: "darwin",
    arch: "arm64",
  });
});
test("clean build installs isolated locked Harness dependencies", async () => {
  const root = await mkdtemp(join(tmpdir(), "textus-build-test-"));
  const calls = [];
  try {
    await ensureDependencies(root, (args) => calls.push(args));
    assert.deepEqual(calls, [
      ["ci", "--prefix", root, "--no-audit", "--no-fund"],
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
