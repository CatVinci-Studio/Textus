// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { emitPluginEvent } from "../app-bridge";
import { PluginHost, type BrokerDeps } from "./broker";
import type { PluginRuntimeInfo } from "./broker";

const running = () => {
  const host = new PluginHost(
    { manifest: { id: "a.clip" } } as unknown as PluginRuntimeInfo,
    {} as BrokerDeps,
  );
  const notify = vi.fn();
  const call = () => Promise.resolve();
  (host as unknown as { endpoint: unknown }).endpoint = { notify, call };
  return { host, notify };
};

describe("a plugin's textus.env", () => {
  it("follows the window's language and theme though it never listened", () => {
    const { host, notify } = running();
    emitPluginEvent("language", "de");
    emitPluginEvent("theme", "dark");
    expect(notify).toHaveBeenCalledWith("$event", {
      name: "language",
      data: "de",
    });
    expect(notify).toHaveBeenCalledWith("$event", {
      name: "theme",
      data: "dark",
    });
    // Nothing else unasked, and nothing once stopped.
    emitPluginEvent("activeDocument", { path: "/a.md" });
    host.stop();
    emitPluginEvent("language", "ru");
    expect(notify).toHaveBeenCalledTimes(2);
  });
});
