import { beforeEach, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
  status: vi.fn(),
  commit: vi.fn(),
  trust: vi.fn(async () => null),
  confirm: vi.fn(),
}));
vi.mock("../../platform/ipc", () => ({
  plugins: {
    gitStatus: calls.status,
    gitCommit: calls.commit,
    gitTrust: calls.trust,
  },
}));
vi.mock("../../engine/controls/app-dialog", () => ({
  showConfirm: calls.confirm,
}));

import { gitHandlers } from "./broker-git";
import type { PluginScope } from "./broker-scope";

const scope = (root: string) =>
  ({ id: "a.b", root: () => root }) as unknown as PluginScope;
const untrusted = () => Promise.reject("git-untrusted: core.fsmonitor");

beforeEach(() => {
  for (const mock of Object.values(calls)) mock.mockReset();
  calls.trust.mockResolvedValue(null);
});

it("asks once whether to trust a repository that runs programs, then goes on", async () => {
  calls.status.mockImplementationOnce(untrusted).mockResolvedValue({
    branch: "main",
    changes: [],
  });
  calls.confirm.mockResolvedValue(true);
  const git = gitHandlers(scope("/work/mine"));
  expect(await git["git.status"]()).toEqual({ branch: "main", changes: [] });
  expect(calls.confirm).toHaveBeenCalledTimes(1);
  expect(String(calls.confirm.mock.calls[0][0])).toContain("core.fsmonitor");
  expect(calls.trust).toHaveBeenCalledWith("/work/mine");
});

it("finds no repository where the writer said no, and doesn't ask again", async () => {
  calls.status.mockImplementation(untrusted);
  calls.commit.mockImplementation(untrusted);
  calls.confirm.mockResolvedValue(false);
  const git = gitHandlers(scope("/work/theirs"));
  // Two at once (a save and a poll) share the one question.
  expect(await Promise.all([git["git.status"](), git["git.status"]()])).toEqual(
    [null, null],
  );
  expect(await git["git.status"]()).toBeNull();
  expect(calls.confirm).toHaveBeenCalledTimes(1);
  expect(calls.trust).not.toHaveBeenCalled();
  await expect(
    git["git.commit"]({ message: "m", paths: ["/work/theirs/a.md"] }),
  ).rejects.toThrow();
  expect(calls.confirm).toHaveBeenCalledTimes(1);
});

it("passes other failures on as they are", async () => {
  calls.status.mockRejectedValue("fatal: bad object");
  await expect(gitHandlers(scope("/work/other"))["git.status"]()).rejects.toBe(
    "fatal: bad object",
  );
  expect(calls.confirm).not.toHaveBeenCalled();
});
