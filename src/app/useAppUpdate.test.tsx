// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];

vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: vi.fn(async () => void calls.push("relaunch")),
}));
vi.mock("../platform/capabilities", () => ({ canAutoUpdate: true }));
vi.mock("../platform/distribution", () => ({
  selfUpdateAllowed: async () => true,
  checkChannel: (channel: string) => channel,
}));
vi.mock("../storage/pending-writes", () => ({
  flushPendingWrites: async () => void calls.push("flush"),
}));
vi.mock("../platform/ipc", () => ({
  updater: {
    check: async () => ({
      version: "9.9.9",
      downloadAndInstall: async () => void calls.push("install"),
    }),
    releaseInstance: async () => void calls.push("release"),
  },
}));

import { useAppUpdate } from "./useAppUpdate";

describe("useAppUpdate", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("gives up the running instance just before the relaunch (#349)", async () => {
    const { result } = renderHook(() => useAppUpdate("stable"));
    await waitFor(() => expect(result.current.version).toBe("9.9.9"));
    await act(() => result.current.install());
    expect(calls).toEqual(["flush", "install", "flush", "release", "relaunch"]);
  });
});
