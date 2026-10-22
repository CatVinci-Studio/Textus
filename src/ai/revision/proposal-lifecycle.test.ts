import { describe, expect, it } from "vitest";
import {
  liveStatus,
  recordStatus,
  recordStatuses,
  type RecordedStatus,
} from "./proposal-lifecycle";

describe("a proposal's lifecycle", () => {
  it("records a decision as it was made, over what was there", () => {
    for (const outcome of [
      "accepted",
      "rejected",
      "replaced",
      "joined",
      "invalid",
    ] as const)
      expect(recordStatus("rejected", { type: "decided", outcome })).toBe(
        outcome,
      );
  });

  it("reads a dropped preview as written in or lost - unless decided already", () => {
    expect(recordStatus(undefined, { type: "dropped", applied: true })).toBe(
      "accepted",
    );
    expect(recordStatus(undefined, { type: "dropped", applied: false })).toBe(
      "invalid",
    );
    expect(recordStatus("replaced", { type: "dropped", applied: false })).toBe(
      "replaced",
    );
  });

  it("puts an accepted proposal back on offer on undo, and back on redo", () => {
    expect(recordStatus("accepted", { type: "back" })).toBeNull();
    expect(recordStatus("rejected", { type: "back" })).toBe("rejected");
    expect(recordStatus(undefined, { type: "applied" })).toBe("accepted");
  });

  it("keeps the record itself when nothing moved", () => {
    const record: Record<string, RecordedStatus> = { a: "accepted" };
    expect(recordStatuses(record, ["a"], { type: "applied" })).toBe(record);
    expect(recordStatuses(record, ["a"], { type: "back" })).toEqual({});
    expect(
      recordStatuses(record, ["b", "c"], {
        type: "decided",
        outcome: "rejected",
      }),
    ).toEqual({ a: "accepted", b: "rejected", c: "rejected" });
  });

  it("reads a live preview off its streaming flag", () => {
    expect(liveStatus({ streaming: true })).toBe("streaming");
    expect(liveStatus({})).toBe("pending");
  });
});
