import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  BETA_MANIFEST_NAME,
  betaAdvances,
  buildManifest,
  compareVersions,
  configProblems,
  forbiddenAssets,
  LEVIS_LAST_TAG,
  levisBridgeProblems,
  manifestProblems,
  MANIFEST_NAME,
} from "./updater-manifest.mjs";

const levisBase = `https://github.com/CatVinci-Studio/Levis/releases/download/${LEVIS_LAST_TAG}`;
const lastLevis = {
  version: LEVIS_LAST_TAG.slice(1),
  platforms: {
    "darwin-aarch64": {
      signature: "s",
      url: `${levisBase}/Levis_aarch64.app.tar.gz`,
    },
    "linux-x86_64": {
      signature: "s",
      url: `${levisBase}/Levis_0.9.8_amd64.AppImage`,
    },
    "windows-x86_64": {
      signature: "s",
      url: `${levisBase}/Levis_0.9.8_x64-setup.exe`,
    },
  },
};

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readRepo = (file) => readFileSync(join(root, file), "utf8");

describe("updater manifest", () => {
  it("this checkout reads textus-latest.json and never uploads latest.json", () => {
    expect(configProblems(readRepo)).toEqual([]);
  });

  it("rejects an endpoint that Levis also reads", () => {
    const conf = JSON.parse(readRepo("src-tauri/tauri.conf.json"));
    conf.plugins.updater.endpoints = [
      "https://github.com/CatVinci-Studio/Textus/releases/latest/download/latest.json",
    ];
    const problems = configProblems((file) =>
      file.endsWith("tauri.conf.json") ? JSON.stringify(conf) : readRepo(file),
    );
    expect(problems.join("\n")).toMatch(/must end in \/textus-latest\.json/);
  });

  it("rejects a release workflow that lets tauri-action upload latest.json", () => {
    const problems = configProblems((file) =>
      file.endsWith("release.yml")
        ? readRepo(file).replace(/includeUpdaterJson: false/, "")
        : readRepo(file),
    );
    expect(problems.join("\n")).toMatch(/includeUpdaterJson: false/);
  });

  it("lets a release carry latest.json only as the last Levis release's", () => {
    expect(
      forbiddenAssets([MANIFEST_NAME, "Textus_1.0.0_x64-setup.exe", ""]),
    ).toEqual([]);
    expect(forbiddenAssets(["latest.json", MANIFEST_NAME], lastLevis)).toEqual(
      [],
    );
    expect(forbiddenAssets(["latest.json"])).toHaveLength(1);
  });

  it("refuses a latest.json that could install Textus or another Levis", () => {
    const textus = structuredClone(lastLevis);
    textus.version = "1.0.0";
    textus.platforms["windows-x86_64"].url =
      "https://github.com/CatVinci-Studio/Textus/releases/download/v1.0.0/Textus_1.0.0_x64-setup.exe";
    expect(levisBridgeProblems(textus).join("\n")).toMatch(
      /not Levis[\s\S]*not on v0\.9\.8[\s\S]*not a Levis asset/,
    );
    const older = structuredClone(lastLevis);
    older.version = "0.9.7";
    expect(levisBridgeProblems(older)).toEqual([
      `latest.json says 0.9.7, not Levis ${LEVIS_LAST_TAG.slice(1)}`,
    ]);
    expect(levisBridgeProblems(lastLevis)).toEqual([]);
  });

  it("builds every platform's entry from the signed artifacts", () => {
    const manifest = buildManifest({
      version: "1.0.0",
      notes: "notes",
      pubDate: "2026-10-14T00:00:00.000Z",
      baseUrl:
        "https://github.com/CatVinci-Studio/Textus/releases/download/v1.0.0/",
      artifacts: [
        { name: "Textus_aarch64.app.tar.gz", signature: "mac\n" },
        { name: "Textus_x64.app.tar.gz", signature: "intel" },
        { name: "Textus_1.0.0_amd64.AppImage", signature: "appimage" },
        { name: "Textus_1.0.0_amd64.deb", signature: "deb" },
        { name: "Textus_1.0.0_x64-setup.exe", signature: "nsis" },
        { name: "textus-1.0.0-x86_64.tar.gz", signature: "ignored" },
      ],
    });
    expect(manifest.platforms["darwin-aarch64"]).toEqual({
      signature: "mac",
      url: "https://github.com/CatVinci-Studio/Textus/releases/download/v1.0.0/Textus_aarch64.app.tar.gz",
    });
    expect(manifest.platforms["darwin-x86_64"].signature).toBe("intel");
    expect(manifest.platforms["linux-x86_64"].signature).toBe("appimage");
    expect(manifest.platforms["linux-x86_64-deb"].signature).toBe("deb");
    expect(manifest.platforms["windows-x86_64-nsis"].signature).toBe("nsis");
    expect(Object.keys(manifest.platforms)).toHaveLength(9);
    expect(manifestProblems(manifest, "1.0.0")).toEqual([]);
  });

  it("reports a missing platform or a version that is not the tag's", () => {
    const manifest = buildManifest({
      version: "1.0.0",
      notes: "",
      pubDate: "",
      baseUrl: "https://example.invalid",
      artifacts: [{ name: "Textus_1.0.0_x64-setup.exe", signature: "s" }],
    });
    expect(manifestProblems(manifest, "1.0.1")).toEqual([
      "manifest says 1.0.0, expected 1.0.1",
      "no signed darwin-aarch64 entry",
      "no signed darwin-x86_64 entry",
      "no signed linux-x86_64 entry",
    ]);
  });
});

describe("beta manifest", () => {
  const rcBase =
    "https://github.com/CatVinci-Studio/Textus/releases/download/v1.0.5-rc.1";
  const rc = buildManifest({
    version: "1.0.5-rc.1",
    notes: "",
    pubDate: "2026-10-20T00:00:00.000Z",
    baseUrl: rcBase,
    // A release candidate has no .rpm: RPM versions can't contain '-'.
    artifacts: [
      { name: "Textus_aarch64.app.tar.gz", signature: "mac" },
      { name: "Textus_x64.app.tar.gz", signature: "intel" },
      { name: "Textus_1.0.5-rc.1_amd64.AppImage", signature: "appimage" },
      { name: "Textus_1.0.5-rc.1_amd64.deb", signature: "deb" },
      { name: "Textus_1.0.5-rc.1_x64-setup.exe", signature: "nsis" },
    ],
  });
  const manifest = (version) => ({ version, platforms: {} });

  it("builds a complete manifest for a release candidate without an .rpm", () => {
    expect(manifestProblems(rc, "1.0.5-rc.1")).toEqual([]);
    expect(rc.platforms["linux-x86_64-rpm"]).toBeUndefined();
    expect(rc.platforms["windows-x86_64"].url).toBe(
      `${rcBase}/Textus_1.0.5-rc.1_x64-setup.exe`,
    );
  });

  it("orders versions as semver does", () => {
    const sorted = [
      "1.0.5",
      "1.0.4",
      "1.0.5-rc.10",
      "1.0.5-rc.2",
      "1.1.0-rc.1",
      "1.0.5-rc.1",
      "1.0.10",
      "1.0.5-beta.1",
    ].sort(compareVersions);
    expect(sorted).toEqual([
      "1.0.4",
      "1.0.5-beta.1",
      "1.0.5-rc.1",
      "1.0.5-rc.2",
      "1.0.5-rc.10",
      "1.0.5",
      "1.0.10",
      "1.1.0-rc.1",
    ]);
    expect(compareVersions("v1.0.5", "1.0.5")).toBe(0);
    expect(() => compareVersions("latest", "1.0.5")).toThrow();
  });

  it("starts from any release when there is no beta manifest yet", () => {
    expect(betaAdvances(null, rc)).toBe(true);
  });

  it("moves forward to a newer release candidate or stable release", () => {
    expect(betaAdvances(manifest("1.0.4"), rc)).toBe(true);
    expect(betaAdvances(rc, manifest("1.0.5-rc.2"))).toBe(true);
    expect(betaAdvances(manifest("1.0.5-rc.2"), manifest("1.0.5"))).toBe(true);
  });

  it("never moves back when an older tag is rebuilt", () => {
    expect(betaAdvances(manifest("1.0.5"), rc)).toBe(false);
    expect(betaAdvances(manifest("1.0.5-rc.2"), rc)).toBe(false);
    expect(betaAdvances(manifest("1.0.6-rc.1"), manifest("1.0.5"))).toBe(false);
  });

  it("refreshes the same version, whose rebuild re-signed its files", () => {
    expect(betaAdvances(rc, structuredClone(rc))).toBe(true);
  });

  it("this checkout's beta endpoint names textus-beta.json", () => {
    expect(readRepo("src-tauri/src/commands/update.rs")).toContain(
      `/download/${BETA_MANIFEST_NAME}"`,
    );
    const problems = configProblems((file) =>
      file.endsWith("update.rs")
        ? readRepo(file).replaceAll(BETA_MANIFEST_NAME, "latest.json")
        : readRepo(file),
    );
    expect(problems.join("\n")).toMatch(/must end in \/textus-beta\.json/);
  });

  it("checks a tag from before the update channel without its endpoint", () => {
    const problems = configProblems((file) => {
      if (file.endsWith("update.rs")) throw new Error("ENOENT");
      return readRepo(file);
    });
    expect(problems).toEqual([]);
  });
});
