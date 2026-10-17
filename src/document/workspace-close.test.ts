import { expect, it, vi } from "vitest";
import {
  confirmWorkspaceClose,
  registerWorkspaceClose,
} from "./workspace-close";
it("blocks closure on a declined task guard and unregisters only its own instance", async () => {
  const old = registerWorkspaceClose("a", async () => true);
  const blocked = vi.fn(async () => false);
  const remove = registerWorkspaceClose("a", blocked);
  old();
  expect(await confirmWorkspaceClose(["unrelated", "a"])).toBe(false);
  expect(blocked).toHaveBeenCalledTimes(1);
  remove();
  expect(await confirmWorkspaceClose(["a"])).toBe(true);
});
it("passes a handoff reason so drafts can be saved before the source unmounts", async () => {
  const guard = vi.fn(async () => true);
  const remove = registerWorkspaceClose("moving", guard);
  await confirmWorkspaceClose(["moving"], "handoff");
  expect(guard).toHaveBeenCalledWith("handoff");
  remove();
});
