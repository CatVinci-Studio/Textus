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
  manifestProblems,
  MANIFEST_NAME,
} from "./updater-manifest.mjs";

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
        ? readRepo(file).replace(/uploadUpdaterJson: false/, "")
        : readRepo(file),
    );
    expect(problems.join("\n")).toMatch(/uploadUpdaterJson: false/);
  });

  it("rejects tauri-action 1.x with the input name from before 1.0", () => {
    const problems = configProblems((file) =>
      file.endsWith("release.yml")
        ? readRepo(file).replace(
            /uploadUpdaterJson: false/,
            "includeUpdaterJson: false",
          )
        : readRepo(file),
    );
    expect(problems.join("\n")).toMatch(
      /v1 must run with uploadUpdaterJson: false/,
    );
  });

  it("accepts the old input name on a tag that still pins tauri-action v0", () => {
    const problems = configProblems((file) =>
      file.endsWith("release.yml")
        ? readRepo(file)
            .replace(/uploadUpdaterJson: false/, "includeUpdaterJson: false")
            .replace(/# v1\.0\.0/, "# v0.6.2")
        : readRepo(file),
    );
    expect(problems).toEqual([]);
  });

  it("refuses any release that carries latest.json", () => {
    expect(
      forbiddenAssets([MANIFEST_NAME, "Textus_1.0.0_x64-setup.exe", ""]),
    ).toEqual([]);
    expect(forbiddenAssets(["latest.json", MANIFEST_NAME])).toEqual([
      "latest.json is on the release",
    ]);
    expect(forbiddenAssets(["latest.json\r"])).toHaveLength(1);
  });

  // A stable release's signed assets, named as tauri-bundler names them.
  const base =
    "https://github.com/CatVinci-Studio/Textus/releases/download/v1.1.0";
  const stable = buildManifest({
    version: "1.1.0",
    notes: "notes",
    pubDate: "2026-10-14T00:00:00.000Z",
    baseUrl: `${base}/`,
    artifacts: [
      { name: "Textus_aarch64.app.tar.gz", signature: "mac\n" },
      { name: "Textus_x64.app.tar.gz", signature: "intel" },
      { name: "Textus_1.1.0_amd64.AppImage", signature: "appimage" },
      { name: "Textus_1.1.0_amd64.deb", signature: "deb" },
      { name: "Textus-1.1.0-1.x86_64.rpm", signature: "rpm" },
      { name: "Textus_1.1.0_x64-setup.exe", signature: "nsis" },
      { name: "Textus_1.1.0_aarch64.AppImage", signature: "arm appimage" },
      { name: "Textus_1.1.0_arm64.deb", signature: "arm deb" },
      { name: "Textus-1.1.0-1.aarch64.rpm", signature: "arm rpm" },
      { name: "Textus_1.1.0_arm64-setup.exe", signature: "arm nsis" },
      { name: "Textus_1.1.0_linux_x86_64.tar.gz", signature: "ignored" },
    ],
  });
  const signed = (key) => stable.platforms[key]?.signature;

  it("builds every platform's entry from the signed artifacts", () => {
    expect(stable.platforms["darwin-aarch64"]).toEqual({
      signature: "mac",
      url: `${base}/Textus_aarch64.app.tar.gz`,
    });
    expect(Object.keys(stable.platforms).sort()).toEqual([
      "darwin-aarch64",
      "darwin-aarch64-app",
      "darwin-x86_64",
      "darwin-x86_64-app",
      "linux-aarch64",
      "linux-aarch64-appimage",
      "linux-aarch64-deb",
      "linux-aarch64-rpm",
      "linux-x86_64",
      "linux-x86_64-appimage",
      "linux-x86_64-deb",
      "linux-x86_64-rpm",
      "windows-aarch64",
      "windows-aarch64-nsis",
      "windows-x86_64",
      "windows-x86_64-nsis",
    ]);
    expect(manifestProblems(stable, "1.1.0")).toEqual([]);
  });

  it("keeps every x64 key on the x64 installers", () => {
    expect(signed("darwin-x86_64")).toBe("intel");
    expect(signed("darwin-x86_64-app")).toBe("intel");
    expect(signed("linux-x86_64")).toBe("appimage");
    expect(signed("linux-x86_64-appimage")).toBe("appimage");
    expect(signed("linux-x86_64-deb")).toBe("deb");
    expect(signed("linux-x86_64-rpm")).toBe("rpm");
    expect(signed("windows-x86_64")).toBe("nsis");
    expect(signed("windows-x86_64-nsis")).toBe("nsis");
  });

  it("serves ARM64 Windows and Linux their own installers", () => {
    expect(signed("linux-aarch64")).toBe("arm appimage");
    expect(signed("linux-aarch64-appimage")).toBe("arm appimage");
    expect(signed("linux-aarch64-deb")).toBe("arm deb");
    expect(signed("linux-aarch64-rpm")).toBe("arm rpm");
    expect(signed("windows-aarch64")).toBe("arm nsis");
    expect(stable.platforms["windows-aarch64-nsis"]).toEqual({
      signature: "arm nsis",
      url: `${base}/Textus_1.1.0_arm64-setup.exe`,
    });
  });

  it("refuses two artifacts for one platform", () => {
    expect(() =>
      buildManifest({
        version: "1.1.0",
        notes: "",
        pubDate: "",
        baseUrl: base,
        artifacts: [
          { name: "Textus_1.1.0_arm64-setup.exe", signature: "a" },
          { name: "Textus_1.1.0_aarch64-setup.exe", signature: "b" },
        ],
      }),
    ).toThrow(/two artifacts serve windows-aarch64/);
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
      "no signed linux-aarch64 entry",
      "no signed linux-x86_64 entry",
      "no signed windows-aarch64 entry",
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
      { name: "Textus_1.0.5-rc.1_aarch64.AppImage", signature: "arm" },
      { name: "Textus_1.0.5-rc.1_arm64.deb", signature: "arm deb" },
      { name: "Textus_1.0.5-rc.1_arm64-setup.exe", signature: "arm nsis" },
    ],
  });
  const manifest = (version) => ({ version, platforms: {} });

  it("builds a complete manifest for a release candidate without an .rpm", () => {
    expect(manifestProblems(rc, "1.0.5-rc.1")).toEqual([]);
    expect(rc.platforms["linux-x86_64-rpm"]).toBeUndefined();
    expect(rc.platforms["linux-aarch64-rpm"]).toBeUndefined();
    expect(rc.platforms["linux-aarch64-deb"].url).toBe(
      `${rcBase}/Textus_1.0.5-rc.1_arm64.deb`,
    );
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
