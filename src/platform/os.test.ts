import { afterEach, describe, expect, it, vi } from "vitest";
import { isAndroidPlatform, isDesktop, isIOSPlatform, modIsMeta } from "./os";

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
