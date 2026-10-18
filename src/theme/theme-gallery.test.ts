import { describe, expect, it, vi } from "vitest";
import type { UserThemeMeta } from "../settings/SettingsContext";
import {
  galleryStatus,
  installedCopy,
  isNewer,
  type GalleryTheme,
} from "./theme-gallery";
import { withUserTheme } from "./theme-import";

vi.mock("../platform/ipc", () => ({ themeGallery: {}, themes: {}, fs: {} }));

const theme = (updated: string): GalleryTheme => ({
  id: "lumen",
  name: "Lumen",
  author: "CatVinci-Studio",
  description: "",
  license: "MIT",
  source: "",
  created: "2026-10-17T00:00:00Z",
  updated,
  css: "themes/lumen/theme.css",
  previews: [],
});

const installed = (updated: string): UserThemeMeta => ({
  id: "user-1",
  name: "Lumen",
  hasDark: false,
  gallery: { id: "lumen", updated, source: "" },
});

describe("theme gallery", () => {
  it("offers Install for a theme with no installed copy", () => {
    expect(galleryStatus(theme("2026-10-17T00:00:00Z"), undefined)).toBe(
      "install",
    );
  });

  it("does not count an imported theme of the same name as installed", () => {
    const imported = { id: "user-2", name: "Lumen", hasDark: false };
    expect(installedCopy(theme("2026-10-17T00:00:00Z"), [imported])).toBe(
      undefined,
    );
  });

  it("shows Installed while the catalog has the same version", () => {
    const copy = installed("2026-10-17T00:00:00Z");
    expect(galleryStatus(theme("2026-10-17T00:00:00Z"), copy)).toBe(
      "installed",
    );
  });

  it("offers Update only when the catalog's version is later", () => {
    const copy = installed("2026-10-17T00:00:00Z");
    expect(galleryStatus(theme("2026-10-18T04:55:06Z"), copy)).toBe("update");
    expect(galleryStatus(theme("2026-10-16T00:00:00Z"), copy)).toBe(
      "installed",
    );
  });

  it("compares timestamps as times, not as text", () => {
    expect(isNewer("2026-10-18T00:00:00Z", "2026-10-18T01:00:00+02:00")).toBe(
      true,
    );
    expect(isNewer("2026-10-18T00:00:00.000Z", "2026-10-18T00:00:00Z")).toBe(
      false,
    );
  });

  it("treats a changed timestamp it can't read as an update", () => {
    expect(isNewer("soon", "2026-10-18T00:00:00Z")).toBe(true);
    expect(isNewer("soon", "soon")).toBe(false);
  });

  it("puts an updated theme back in its place in the list", () => {
    const other = { id: "user-0", name: "Other", hasDark: false };
    const old = installed("2026-10-17T00:00:00Z");
    const next = installed("2026-10-18T00:00:00Z");
    expect(withUserTheme([old, other], next)).toEqual([next, other]);
    expect(withUserTheme([other], old)).toEqual([other, old]);
  });
});
