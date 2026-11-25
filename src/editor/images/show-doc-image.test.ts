// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { showDocImage } from "./image-plugin";

vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
  convertFileSrc: (path: string) =>
    `asset://localhost/${encodeURIComponent(path)}`,
}));

describe("showDocImage (#825)", () => {
  it("never sends our origin as the referrer", () => {
    // Image hosts that guard against hotlinking 403 a referrer of another
    // origin, which is what the webview sent for every remote picture.
    const img = document.createElement("img");
    showDocImage(img, "https://cdn.example.com/a.png", "/home/a/doc.md");
    expect(img.referrerPolicy).toBe("no-referrer");
  });

  it("keeps the policy for a local picture too", () => {
    const img = document.createElement("img");
    showDocImage(img, "pictures/a.png", "/home/a/doc.md");
    expect(img.referrerPolicy).toBe("no-referrer");
    expect(img.src).toContain("asset://localhost/");
  });
});
