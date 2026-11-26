import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { collectVersions } from "./check-versions.mjs";
import {
  bumpFiles,
  compareVersions,
  parseArgs,
  VERSION_FILES,
} from "./release-bump.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(join(root, file), "utf8");

describe("release arguments", () => {
  it("takes a version and the three flags", () => {
    expect(parseArgs(["1.4.8"])).toEqual({
      version: "1.4.8",
      ios: false,
      resume: false,
      dryRun: false,
    });
    expect(parseArgs(["--dry-run", "v1.4.8", "--ios", "--resume"])).toEqual({
      version: "1.4.8",
      ios: true,
      resume: true,
      dryRun: true,
    });
    expect(parseArgs(["1.4.8-rc.1"]).version).toBe("1.4.8-rc.1");
  });

  it("refuses a missing, malformed or second version and unknown flags", () => {
    expect(() => parseArgs([])).toThrow("which version?");
    expect(() => parseArgs(["1.4"])).toThrow("not a version");
    expect(() => parseArgs(["1.4.8", "1.4.9"])).toThrow("one version only");
    expect(() => parseArgs(["1.4.8", "--force"])).toThrow("unknown option");
  });

  it("refuses --ios for a pre-release", () => {
    expect(() => parseArgs(["1.4.8-rc.1", "--ios"])).toThrow("stable");
  });
});

describe("version order", () => {
  it("orders cores, then a pre-release before its release", () => {
    const sorted = [
      "1.4.10",
      "1.4.8",
      "1.4.8-rc.10",
      "1.4.8-rc.2",
      "1.4.7",
      "1.5.0-rc.1",
      "1.4.8-beta.1",
    ].sort(compareVersions);
    expect(sorted).toEqual([
      "1.4.7",
      "1.4.8-beta.1",
      "1.4.8-rc.2",
      "1.4.8-rc.10",
      "1.4.8",
      "1.4.10",
      "1.5.0-rc.1",
    ]);
    expect(compareVersions("1.4.8", "1.4.8")).toBe(0);
  });
});

describe("version bump", () => {
  it("changes only the version lines of the five files", () => {
    const changed = bumpFiles(read, "9.8.7-rc.6");
    expect(Object.keys(changed).sort()).toEqual([...VERSION_FILES].sort());
    const versions = collectVersions((file) => changed[file] ?? read(file));
    expect(new Set(Object.values(versions))).toEqual(new Set(["9.8.7-rc.6"]));
    for (const file of VERSION_FILES) {
      const before = read(file).split("\n");
      const after = changed[file].split("\n");
      expect(after).toHaveLength(before.length);
      const lines = after.filter((line, i) => line !== before[i]);
      expect(lines.length).toBe(file === "package-lock.json" ? 2 : 1);
      for (const line of lines) expect(line).toMatch(/version.*9\.8\.7-rc\.6/);
    }
  });

  it("is a no-op at the current version", () => {
    const current = JSON.parse(read("package.json")).version;
    expect(bumpFiles(read, current)).toEqual({});
  });

  it("refuses a file whose version line moved", () => {
    const moved = (file) =>
      file === "src-tauri/Cargo.toml"
        ? read(file).replace(
            'name = "textus"\n',
            'name = "textus"\nedition = "2021"\n',
          )
        : read(file);
    expect(() => bumpFiles(moved, "9.8.7")).toThrow("src-tauri/Cargo.toml");
  });
});
