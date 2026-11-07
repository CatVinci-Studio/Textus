import { describe, expect, it } from "vitest";
import { keptOriginal } from "./useOwnRevisions";

const SHOWN = "The harbour was quiet at dawn.\n";

describe("keptOriginal", () => {
  it("carries on from the original when the editor shows the revised text", () => {
    const text = JSON.stringify({ base: "silent", revised: SHOWN });
    expect(keptOriginal(text, SHOWN)).toBe("silent");
  });

  it("carries on from an original kept from before 1.3, with no revised text", () => {
    expect(keptOriginal(JSON.stringify({ base: "silent" }), SHOWN)).toBe(
      "silent",
    );
  });

  it("gives way when the file no longer holds what was revised", () => {
    const text = JSON.stringify({ base: "empty", revised: "still" });
    expect(keptOriginal(text, SHOWN)).toBeNull();
  });

  it("has nothing for no file, a broken one, or one without an original", () => {
    expect(keptOriginal(null, SHOWN)).toBeNull();
    expect(keptOriginal("{", SHOWN)).toBeNull();
    expect(keptOriginal("{}", SHOWN)).toBeNull();
  });
});
