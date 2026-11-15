import { describe, expect, it } from "vitest";
import {
  ownFolderMoved,
  storedOwnFolder,
  resolvedDocumentPath,
  storedDocumentPath,
} from "./documents-path";

const DOCS = "/var/mobile/Containers/Data/Application/AAAA-1111/Documents";
const OLD = "/var/mobile/Containers/Data/Application/BBBB-2222/Documents";
const SIM =
  "/Users/me/Library/Developer/CoreSimulator/Devices/D-1/data/Containers/Data/Application/CCCC-3333/Documents";

describe("storedDocumentPath", () => {
  it("stores a document in Documents relative to it", () => {
    expect(storedDocumentPath(`${DOCS}/notes/a.md`, DOCS)).toBe(
      "documents:notes/a.md",
    );
    expect(storedDocumentPath(`${DOCS}/a.md`, `${DOCS}/`)).toBe(
      "documents:a.md",
    );
    // Rust answers /private/var/… for the /var/… folder: one place.
    expect(storedDocumentPath(`/private${DOCS}/a.md`, DOCS)).toBe(
      "documents:a.md",
    );
  });

  it("keeps another container, and every path while ours isn't known", () => {
    expect(storedDocumentPath(`${OLD}/notes/a.md`, DOCS)).toBe(
      `${OLD}/notes/a.md`,
    );
    expect(storedDocumentPath(`/private${OLD}/a.md`, null)).toBe(
      `/private${OLD}/a.md`,
    );
    expect(storedDocumentPath(`${SIM}/a.md`, null)).toBe(`${SIM}/a.md`);
  });

  it("leaves everything else alone, and is idempotent", () => {
    // A file picked in the Files app, a desktop path, an already stored one.
    for (const path of [
      "file:///private/var/mobile/Library/Mobile%20Documents/a.md",
      `file://${OLD}/a.md`,
      "/Users/me/notes/a.md",
      "C:\\notes\\a.md",
      "documents:notes/a.md",
      DOCS,
    ])
      expect(storedDocumentPath(path, DOCS)).toBe(path);
  });
});

describe("resolvedDocumentPath", () => {
  it("resolves a stored path against the current Documents folder", () => {
    expect(resolvedDocumentPath("documents:notes/a.md", DOCS)).toBe(
      `${DOCS}/notes/a.md`,
    );
    expect(resolvedDocumentPath("documents:a.md", `${DOCS}/`)).toBe(
      `${DOCS}/a.md`,
    );
  });

  it("never moves another container's path into this one's", () => {
    expect(resolvedDocumentPath(`${OLD}/notes/a.md`, DOCS)).toBe(
      `${OLD}/notes/a.md`,
    );
  });

  it("round-trips, and leaves other paths alone", () => {
    const path = `${DOCS}/x/y.md`;
    expect(resolvedDocumentPath(storedDocumentPath(path, DOCS), DOCS)).toBe(
      path,
    );
    expect(resolvedDocumentPath("/Users/me/a.md", DOCS)).toBe("/Users/me/a.md");
    expect(resolvedDocumentPath("file:///x/a.md", DOCS)).toBe("file:///x/a.md");
  });

  it("moves the open folder an earlier version kept whole into this install's Documents", () => {
    const docs = "/var/mobile/Containers/Data/Application/NEW/Documents/";
    expect(
      ownFolderMoved(
        "/private/var/mobile/Containers/Data/Application/OLD/Documents/Notes",
        docs,
      ),
    ).toBe(docs + "Notes");
    // Already this install's, or another app's, it stays.
    expect(ownFolderMoved(docs + "Notes", docs)).toBe(docs + "Notes");
    // Documents itself, kept whole by an earlier version.
    expect(
      ownFolderMoved(
        "/var/mobile/Containers/Data/Application/OLD/Documents",
        docs,
      ),
    ).toBe(docs.slice(0, -1));
    expect(ownFolderMoved("documents:Notes", docs)).toBe(docs + "Notes");
    expect(ownFolderMoved("file:///x/y", docs)).toBe("file:///x/y");
  });

  it("keeps the open folder Documents as documents:, given back without a slash", () => {
    expect(storedOwnFolder(DOCS, DOCS)).toBe("documents:");
    expect(storedOwnFolder(`/private${DOCS}/`, DOCS)).toBe("documents:");
    expect(storedOwnFolder(`${DOCS}/n`, DOCS)).toBe("documents:n");
    expect(resolvedDocumentPath("documents:", `${DOCS}/`)).toBe(DOCS);
  });
});
