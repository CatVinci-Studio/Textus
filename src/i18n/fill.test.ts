import { expect, it } from "vitest";
import { fill } from "./fill";

it("fills every place a name stands, values as written", () => {
  expect(fill("{n} of {n}, {who}", { n: 2, who: "$& you" })).toBe(
    "2 of 2, $& you",
  );
  expect(fill("{missing} stays", {})).toBe("{missing} stays");
});
