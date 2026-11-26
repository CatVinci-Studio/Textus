// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorView } from "@milkdown/kit/prose/view";
import { setDocumentOpener, type OpenRequest } from "../../utils/open-document";

const fs = vi.hoisted(() => ({
  resolveNoteLink: vi.fn(),
  createDocument: vi.fn(),
  createFolder: vi.fn(),
  fileMtimeMs: vi.fn(),
}));
vi.mock("../../platform/ipc", () => ({ fs, links: {} }));
vi.mock("../../platform/window-folder", () => ({ windowFolder: () => "/v" }));

const { followNoteLink } = await import("./note-link-follow");
const { openLinkHref } = await import("./link-click-plugin");

const view = {} as EditorView;
let opened: ({ path: string } & OpenRequest)[] = [];
let stopOpening = () => {};

beforeEach(() => {
  opened = [];
  stopOpening = setDocumentOpener((path, request) => {
    opened.push({ path, ...request });
  });
  fs.fileMtimeMs.mockResolvedValue(1);
  fs.createDocument.mockResolvedValue({ path: "ok", made: "ok" });
  fs.createFolder.mockResolvedValue({ path: "ok", made: "ok" });
});
afterEach(() => {
  stopOpening();
  vi.clearAllMocks();
});

describe("following a link to a note", () => {
  it("opens a block link at the block, a nested one at its last heading under the others", async () => {
    fs.resolveNoteLink.mockResolvedValue({ path: "/v/Note.md", exists: true });
    await followNoteLink(view, "[[Note#^abc123|x]]", "/v/a.md", "/v");
    await followNoteLink(view, "[[Note#A#B]]", "/v/a.md", "/v");
    expect(opened).toEqual([
      { path: "/v/Note.md", anchor: "^abc123" },
      { path: "/v/Note.md", anchor: "A#B" },
    ]);
    expect(fs.resolveNoteLink).toHaveBeenCalledWith(
      "/v/a.md",
      "Note",
      "/v",
      true,
    );
  });

  it("finds a note from an unsaved draft by the folder's top", async () => {
    fs.resolveNoteLink.mockResolvedValue({ path: "/v/Note.md", exists: true });
    await followNoteLink(view, "[[Note]]", null, "/v");
    expect(opened).toEqual([{ path: "/v/Note.md" }]);
    expect(fs.resolveNoteLink).toHaveBeenCalledWith("/v/_", "Note", "/v", true);
  });

  it("opens a Markdown link's relative path from an unsaved draft by the folder's top", async () => {
    openLinkHref(view, "Blocks.md", null);
    await vi.waitFor(() =>
      expect(opened).toEqual([
        expect.objectContaining({ path: "/v/Blocks.md" }),
      ]),
    );
  });

  it("asks for a table's [[Note\\|alias]] by the note's name alone", async () => {
    fs.resolveNoteLink.mockResolvedValue({ path: "/v/Note.md", exists: true });
    await followNoteLink(view, "[[Note\\|alias]]", "/v/a.md", null);
    expect(fs.resolveNoteLink).toHaveBeenCalledWith(
      "/v/a.md",
      "Note",
      null,
      true,
    );
  });

  it("opens a linked PDF or picture as a file", async () => {
    fs.resolveNoteLink.mockResolvedValue({
      path: "/v/docs/a.pdf",
      exists: true,
    });
    await followNoteLink(view, "[[a.pdf]]", "/v/a.md", "/v");
    expect(opened).toEqual([{ path: "/v/docs/a.pdf", linked: true }]);
  });

  it("creates a missing note a wikilink names, then opens it", async () => {
    fs.resolveNoteLink.mockResolvedValue({
      path: "/v/Inbox/Idea.md",
      exists: false,
    });
    fs.fileMtimeMs.mockResolvedValue(null);
    await followNoteLink(view, "[[Idea]]", "/v/a.md", "/v");
    expect(fs.createFolder).toHaveBeenCalledWith("/v", "Inbox");
    expect(fs.createDocument).toHaveBeenCalledWith("/v/Inbox", "Idea.md");
    expect(opened).toEqual([{ path: "/v/Inbox/Idea.md", anchor: undefined }]);
  });

  it("opens nothing when the note couldn't be made, nor for a Markdown link", async () => {
    fs.resolveNoteLink.mockResolvedValue({ path: "/v/Idea.md", exists: false });
    fs.createDocument.mockRejectedValue("Already exists. [exists]");
    await followNoteLink(view, "[[Idea]]", "/v/a.md", "/v");
    await followNoteLink(view, "Idea.md", "/v/a.md", "/v");
    expect(fs.createDocument).toHaveBeenCalledTimes(1);
    expect(opened).toEqual([]);
  });
});
