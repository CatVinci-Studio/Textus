import { expect, it } from "vitest";
import { heldWhileBusy } from "./useHeldWhileBusy";

const idle = {
  quickAsk: { busy: false, history: [] },
  quickAskOpen: false,
  writing: false,
  statuses: {},
  filePath: "/a.md",
};

it("holds an untitled document's editor while a proposal in it waits, a file's not", () => {
  const waiting = { ...idle, statuses: { call: "pending" as const } };
  // Kept with the file, they come back when it opens.
  expect(heldWhileBusy(waiting)).toBe(false);
  expect(heldWhileBusy({ ...waiting, filePath: null })).toBe(true);
  expect(
    heldWhileBusy({ ...idle, filePath: null, statuses: { call: "accepted" } }),
  ).toBe(false);
  expect(heldWhileBusy({ ...idle, statuses: { call: "streaming" } })).toBe(
    true,
  );
});
