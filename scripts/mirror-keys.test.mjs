import { describe, expect, it } from "vitest";
import { mirrorKey, mirrorManifest } from "./mirror-keys.mjs";

// What gh release download fetches for a stable release, plus files it must
// leave out.
const stable = [
  "Textus_1.1.0_aarch64.dmg",
  "Textus_1.1.0_x64.dmg",
  "Textus_1.1.0_x64-setup.exe",
  "Textus_1.1.0_amd64.AppImage",
  "Textus_1.1.0_amd64.deb",
  "Textus-1.1.0-1.x86_64.rpm",
  "Textus_1.1.0_arm64-setup.exe",
  "Textus_1.1.0_aarch64.AppImage",
  "Textus_1.1.0_arm64.deb",
  "Textus-1.1.0-1.aarch64.rpm",
  "Textus_1.1.0_linux_x86_64.tar.gz",
  "textus-bin-1.1.0-1-x86_64.pkg.tar.zst",
  "Textus_1.1.0_x64-setup.exe.sig",
];

describe("download mirror keys", () => {
  it("keeps the x64 keys the website already reads", () => {
    const { files } = mirrorManifest("v1.1.0", stable);
    expect(files.mac).toBe("releases/v1.1.0/Textus_1.1.0_aarch64.dmg");
    expect(files["mac-intel"]).toBe("releases/v1.1.0/Textus_1.1.0_x64.dmg");
    expect(files.windows).toBe("releases/v1.1.0/Textus_1.1.0_x64-setup.exe");
    expect(files.linux).toBe("releases/v1.1.0/Textus_1.1.0_amd64.AppImage");
    expect(files.deb).toBe("releases/v1.1.0/Textus_1.1.0_amd64.deb");
    expect(files.rpm).toBe("releases/v1.1.0/Textus-1.1.0-1.x86_64.rpm");
  });

  it("adds ARM64 Windows and Linux under their own keys", () => {
    const { files } = mirrorManifest("v1.1.0", stable);
    expect(files["windows-arm64"]).toBe(
      "releases/v1.1.0/Textus_1.1.0_arm64-setup.exe",
    );
    expect(files["linux-arm64"]).toBe(
      "releases/v1.1.0/Textus_1.1.0_aarch64.AppImage",
    );
    expect(files["deb-arm64"]).toBe("releases/v1.1.0/Textus_1.1.0_arm64.deb");
    expect(files["rpm-arm64"]).toBe(
      "releases/v1.1.0/Textus-1.1.0-1.aarch64.rpm",
    );
  });

  it("writes the manifest in a fixed key order, without other files", () => {
    // The order gh lists them in must not matter.
    const manifest = mirrorManifest("v1.1.0", [...stable].reverse());
    expect(manifest.tag).toBe("v1.1.0");
    expect(manifest.version).toBe("1.1.0");
    expect(Object.keys(manifest.files)).toEqual([
      "mac",
      "mac-intel",
      "windows",
      "linux",
      "deb",
      "rpm",
      "windows-arm64",
      "linux-arm64",
      "deb-arm64",
      "rpm-arm64",
    ]);
  });

  it("mirrors a release from before ARM64 as it did", () => {
    const { files } = mirrorManifest("v1.0.4", [
      "Textus_1.0.4_aarch64.dmg",
      "Textus_1.0.4_x64.dmg",
      "Textus_1.0.4_x64-setup.exe",
      "Textus_1.0.4_amd64.AppImage",
      "Textus_1.0.4_amd64.deb",
      "Textus-1.0.4-1.x86_64.rpm",
    ]);
    expect(Object.keys(files)).toEqual([
      "mac",
      "mac-intel",
      "windows",
      "linux",
      "deb",
      "rpm",
    ]);
  });

  it("ignores everything that is not an installer", () => {
    expect(mirrorKey("Textus_1.1.0_linux_x86_64.tar.gz")).toBeNull();
    expect(mirrorKey("Textus_1.1.0_arm64.deb.sig")).toBeNull();
    expect(mirrorKey("manifest.json")).toBeNull();
  });

  it("refuses two files for one key", () => {
    expect(() =>
      mirrorManifest("v1.1.0", [
        "Textus_1.1.0_arm64-setup.exe",
        "Other_1.1.0_arm64-setup.exe",
      ]),
    ).toThrow(/both windows-arm64/);
  });
});
