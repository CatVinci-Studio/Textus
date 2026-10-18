import { describe, expect, it } from "vitest";
import { checkChannel } from "./distribution";

describe("checkChannel", () => {
  it("asks the channel the user chose when the app installs its own updates", () => {
    expect(checkChannel("stable", true)).toBe("stable");
    expect(checkChannel("beta", true)).toBe("beta");
  });

  it("asks only for stable releases in a package-manager build", () => {
    expect(checkChannel("beta", false)).toBe("stable");
    expect(checkChannel("stable", false)).toBe("stable");
  });
});
