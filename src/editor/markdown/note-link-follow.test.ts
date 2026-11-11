// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorView } from "@milkdown/kit/prose/view";
import { OPEN_FILE_IN_TAB_EVENT, type OpenFileInTab } from "../../utils/events";

const fs = vi.hoisted(() => ({
  resolveNoteLink: vi.fn(),
  createDocument: vi.fn(),
  createFolder: vi.fn(),
  fileMtimeMs: vi.fn(),
}));
vi.mock("../../platform/ipc", () => ({ fs }));

const { followNoteLink } = await import("./note-link-follow");

const view = {} as EditorView;
let opened: OpenFileInTab[] = [];
const onOpen = (e: Event) =>
  opened.push((e as CustomEvent<OpenFileInTab>).detail);

beforeEach(() => {
  opened = [];
  window.addEventListener(OPEN_FILE_IN_TAB_EVENT, onOpen);
  fs.fileMtimeMs.mockResolvedValue(1);
  fs.createDocument.mockResolvedValue("ok");
  fs.createFolder.mockResolvedValue("ok");
});
afterEach(() => {
  window.removeEventListener(OPEN_FILE_IN_TAB_EVENT, onOpen);
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
