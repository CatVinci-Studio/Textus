import { describe, expect, it } from "vitest";
import {
  canRun,
  canSwitch,
  nextStatus,
  type PluginEvent,
  type PluginStatus,
} from "./lifecycle";

describe("a plugin's lifecycle", () => {
  it("starts from its files: broken, incompatible, or as its switch was", () => {
    const read = (
      manifest: "ok" | "broken" | "incompatible",
      enabled: boolean,
    ): PluginEvent => ({ type: "read", manifest, enabled });
    expect(nextStatus(null, read("ok", true))).toBe("on");
    expect(nextStatus(null, read("ok", false))).toBe("off");
    expect(nextStatus(null, read("broken", true))).toBe("broken");
    expect(nextStatus(null, read("incompatible", true))).toBe("incompatible");
    // Read again (an install, a reload) whatever it was.
    expect(nextStatus("failed", read("ok", false))).toBe("off");
  });

  it("moves between off, on and failed as the table says", () => {
    const cases: [PluginStatus, PluginEvent["type"], PluginStatus][] = [
      ["off", "enable", "on"],
      ["failed", "enable", "on"],
      ["on", "disable", "off"],
      ["failed", "disable", "off"],
      ["on", "fail", "failed"],
      ["off", "fail", "off"],
      ["on", "revoke", "off"],
      ["failed", "revoke", "failed"],
    ];
    for (const [from, type, to] of cases)
      expect(nextStatus(from, { type } as PluginEvent), `${from} ${type}`).toBe(
        to,
      );
  });

  it("never switches a plugin whose manifest can't be used", () => {
    for (const from of ["broken", "incompatible"] as const)
      for (const type of ["enable", "disable", "fail", "revoke"] as const) {
        expect(nextStatus(from, { type })).toBe(from);
        expect(canSwitch(from)).toBe(false);
      }
  });

  it("runs only on, with every plugin on", () => {
    expect(canRun("on", true)).toBe(true);
    expect(canRun("on", false)).toBe(false);
    expect(canRun("failed", true)).toBe(false);
  });
});
