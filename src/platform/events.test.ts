// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { listenToThisWindow, unlistenAll } from "./events";

interface ListenArgs {
  event: string;
  target: { kind: string; label?: string };
}

/** Minimal stand-in for the Tauri IPC globals, capturing what the event
 *  plugin is asked to register. */
function installFakeRuntime(label: string): ListenArgs[] {
  const calls: ListenArgs[] = [];
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
    metadata: {
      currentWindow: { label },
      currentWebview: { label, windowLabel: label },
    },
    invoke: (cmd: string, args: ListenArgs) => {
      if (cmd === "plugin:event|listen") calls.push(args);
      return Promise.resolve(1);
    },
    transformCallback: () => 1,
    unregisterCallback: () => {},
    plugins: {},
  };
  return calls;
}

describe("listenToThisWindow", () => {
  it("registers for this window's label, never the app-wide catch-all", async () => {
    // A bare `listen()` would register `{ kind: "Any" }`, which Tauri treats
    // as a catch-all: it also receives events emit_to'd at ANOTHER window, so
    // e.g. a file opened in tab mode landed in every open window at once.
    const calls = installFakeRuntime("window-3");
    await listenToThisWindow("open-paths-as-tabs", () => {});

    expect(calls).toHaveLength(1);
    expect(calls[0].event).toBe("open-paths-as-tabs");
    expect(calls[0].target).toEqual({ kind: "AnyLabel", label: "window-3" });
  });
});

describe("unlistenAll", () => {
  it("unsubscribes every listener once the cleanup runs", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const cleanup = unlistenAll(
      Promise.resolve(first),
      Promise.resolve(second),
    );

    // Nothing happens at registration time - it only hands back a teardown.
    await Promise.resolve();
    expect(first).not.toHaveBeenCalled();

    cleanup();
    // The unlisten functions resolve asynchronously, so they run a tick later.
    await Promise.resolve();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });
});
