import { describe, expect, it, vi } from "vitest";
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

describe("a build that can't install its own updates", () => {
  it("sends the portable build to the site, a package build to its manager", async () => {
    const strings = {
      updatePortable: "portable",
      updateViaPackageManager: "package",
    } as Parameters<typeof import("./distribution").updateElsewhere>[0];
    for (const [built, said] of [
      ["portable", "portable"],
      ["aur", "package"],
    ] as const) {
      vi.resetModules();
      vi.doMock("./ipc", () => ({
        distribution: { appDistribution: async () => built },
      }));
      const { selfUpdateAllowed, updateElsewhere } =
        await import("./distribution");
      expect(await selfUpdateAllowed()).toBe(false);
      expect(updateElsewhere(strings)).toBe(said);
    }
  });
});
