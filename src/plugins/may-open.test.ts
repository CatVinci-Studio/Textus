import { describe, expect, it, vi } from "vitest";

vi.mock("./views/webviews", () => ({
  webviewsOf: (id: string) =>
    id === "a.viewer" ? [{ resource: "/elsewhere/shown.pdf" }] : [],
}));

const { mayOpen } = await import("./may-open");

describe("mayOpen", () => {
  it("opens the folder's files with files.read, never one elsewhere", () => {
    const read = ["files.read"];
    expect(mayOpen("a.b", read, "/notes", "/notes/x.md")).toBe(true);
    expect(mayOpen("a.b", read, "/notes", "/notes/../etc/passwd")).toBe(false);
    expect(mayOpen("a.b", read, "/notes", "/etc/passwd")).toBe(false);
    expect(mayOpen("a.b", [], "/notes", "/notes/x.md")).toBe(false);
    expect(mayOpen("a.b", read, null, "/notes/x.md")).toBe(false);
    // Writing includes reading.
    expect(mayOpen("a.b", ["files.write"], "/notes", "/notes/x.md")).toBe(true);
  });

  it("opens a file its own view shows, with no permission", () => {
    expect(mayOpen("a.viewer", [], null, "/elsewhere/shown.pdf")).toBe(true);
    expect(mayOpen("a.other", [], null, "/elsewhere/shown.pdf")).toBe(false);
  });
});
