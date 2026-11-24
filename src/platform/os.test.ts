import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isAndroidPlatform,
  isDesktop,
  isIOSPlatform,
  isLinuxPlatform,
  isWebKitEngine,
  modIsMeta,
} from "./os";

// jsdom's navigator has no maxTouchPoints to spy on - swap in a plain one.
function stub(platform: string, userAgent: string, maxTouchPoints = 0) {
  vi.stubGlobal("navigator", { platform, userAgent, maxTouchPoints });
}

const MAC_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)";

afterEach(() => vi.unstubAllGlobals());

describe("isIOSPlatform / isDesktop", () => {
  it("detects an iPhone webview", () => {
    stub(
      "iPhone",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
      5,
    );
    expect(isIOSPlatform()).toBe(true);
    expect(isDesktop()).toBe(false);
  });

  it("detects an iPad reporting a desktop-class Mac user agent", () => {
    stub("MacIntel", MAC_UA, 5);
    expect(isIOSPlatform()).toBe(true);
    expect(isDesktop()).toBe(false);
  });

  it("keeps a real Mac on desktop", () => {
    stub("MacIntel", MAC_UA, 0);
    expect(isIOSPlatform()).toBe(false);
    expect(isDesktop()).toBe(true);
  });

  it("keeps Windows and Linux on desktop", () => {
    stub("Win32", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
    expect(isDesktop()).toBe(true);
    stub("Linux x86_64", "Mozilla/5.0 (X11; Linux x86_64)");
    expect(isDesktop()).toBe(true);
  });

  it("counts only a Linux desktop as Linux, not an iPhone emulated on one", () => {
    stub("Linux x86_64", "Mozilla/5.0 (X11; Linux x86_64)");
    expect(isLinuxPlatform()).toBe(true);
    stub(
      "Linux x86_64",
      "Mozilla/5.0 (iPhone; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
      1,
    );
    expect(isLinuxPlatform()).toBe(false);
    stub("Linux armv8l", "Mozilla/5.0 (Linux; Android 14; Pixel 8)", 5);
    expect(isLinuxPlatform()).toBe(false);
  });

  it("never counts Android as desktop", () => {
    stub("Linux armv8l", "Mozilla/5.0 (Linux; Android 14; Pixel 8)", 5);
    expect(isAndroidPlatform()).toBe(true);
    expect(isIOSPlatform()).toBe(false);
    expect(isDesktop()).toBe(false);
  });
});

describe("modIsMeta", () => {
  it("treats Macs and iOS devices as Cmd, as ProseMirror does", () => {
    for (const platform of ["MacIntel", "iPhone", "iPad", "iPod touch"])
      expect(modIsMeta(platform)).toBe(true);
  });

  it("treats everything else as Ctrl", () => {
    for (const platform of ["Win32", "Linux x86_64", ""])
      expect(modIsMeta(platform)).toBe(false);
  });
});

describe("isWebKitEngine", () => {
  it("is WebKit on macOS, iOS and Linux, Chromium on Windows and Android", () => {
    const cases: [string, string, boolean][] = [
      [
        "MacIntel",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)",
        true,
      ],
      [
        "iPhone",
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
        true,
      ],
      [
        "Linux x86_64",
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko)",
        true,
      ],
      [
        "Win32",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
        false,
      ],
      [
        "Linux armv8l",
        "Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36",
        false,
      ],
    ];
    for (const [platform, ua, webkit] of cases) {
      stub(platform, ua);
      expect(isWebKitEngine()).toBe(webkit);
    }
  });
});
