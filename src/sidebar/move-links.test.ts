import { beforeEach, expect, it, vi } from "vitest";
import { fs } from "../platform/ipc";
import { showConfirm } from "../ui/app-dialog";
import { getWindowAccess } from "../plugins/app-bridge";
import { resolveStrings } from "../i18n/strings";
import { updateLinksAfterMove } from "./move-links";

vi.mock("../platform/ipc", () => ({
  fs: {
    folderConventions: vi.fn(),
    documentLinkRoot: vi.fn(),
    folderDocuments: vi.fn(),
    indexFolder: vi.fn(),
    readTextFile: vi.fn(),
    writeTextFile: vi.fn(),
  },
}));
vi.mock("../ui/app-dialog", () => ({
  showConfirm: vi.fn(),
  showMessage: vi.fn(),
}));
vi.mock("../plugins/app-bridge", () => ({ getWindowAccess: vi.fn() }));

const t = resolveStrings("en");
// After /w/plan.md became /w/archive/plan.md; CRLF and a BOM must survive.
const disk: Record<string, string> = {
  "/w/index.md": "﻿# Index\r\n[p](plan.md) and [[plan]]\r\n",
  "/w/archive/plan.md": "![](pic.png)\n",
};
const at = <T>(value: T) => ({ value, app: "obsidian", root: "/w" });
/** A vault's conventions: wikilinks, and updates on a rename as given. */
const vault = (update = "always") => ({
  sources: [{ app: "obsidian", root: "/w" }],
  linkStyle: at("wiki"),
  linkPath: at("shortest"),
  linkRoot: null,
  updateLinks: at(update),
  attachments: at("/"),
  softBreaks: at(true),
  templates: null,
  daily: null,
  newNotes: null,
  ignore: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fs.folderConventions).mockResolvedValue({
    ...vault(),
    sources: [],
    linkStyle: null,
    updateLinks: null,
  });
  vi.mocked(fs.documentLinkRoot).mockResolvedValue("/w");
  vi.mocked(fs.folderDocuments).mockResolvedValue({
    documents: Object.entries(disk).map(([path, text]) => ({
      path,
      rel: path.slice(3),
      text,
    })),
    truncated: false,
  });
  vi.mocked(fs.indexFolder).mockResolvedValue({
    files: [...Object.keys(disk), "/w/pic.png"].map((path) => ({
      path,
      rel: path.slice(3),
    })),
    truncated: false,
  });
  vi.mocked(fs.readTextFile).mockImplementation(async (p) => disk[p]);
  vi.mocked(getWindowAccess).mockReturnValue(null);
});

const written = () =>
  Object.fromEntries(vi.mocked(fs.writeTextFile).mock.calls);

it("asks first outside a vault, and changes nothing when told not to", async () => {
  vi.mocked(showConfirm).mockResolvedValue(false);
  await updateLinksAfterMove("/w/plan.md", "/w/archive/plan.md", "/w", t);
  expect(showConfirm).toHaveBeenCalledOnce();
  expect(fs.writeTextFile).not.toHaveBeenCalled();
});

it("rewrites only the targets' bytes once the user agrees", async () => {
  vi.mocked(showConfirm).mockResolvedValue(true);
  await updateLinksAfterMove("/w/plan.md", "/w/archive/plan.md", "/w", t);
  expect(written()).toEqual({
    "/w/index.md": "﻿# Index\r\n[p](archive/plan.md) and [[plan]]\r\n",
    "/w/archive/plan.md": "![](../pic.png)\n",
  });
});

it("updates at once in an Obsidian vault unless the vault turned that off", async () => {
  vi.mocked(fs.folderConventions).mockResolvedValue(vault());
  await updateLinksAfterMove("/w/plan.md", "/w/archive/plan.md", "/w", t);
  expect(showConfirm).not.toHaveBeenCalled();
  expect(Object.keys(written())).toHaveLength(2);

  vi.mocked(fs.writeTextFile).mockClear();
  vi.mocked(fs.folderConventions).mockResolvedValue(vault("ask"));
  vi.mocked(showConfirm).mockResolvedValue(false);
  await updateLinksAfterMove("/w/plan.md", "/w/archive/plan.md", "/w", t);
  expect(showConfirm).toHaveBeenCalledOnce();
  expect(fs.writeTextFile).not.toHaveBeenCalled();
});

it("edits a document with unsaved changes in its tab, not on disk", async () => {
  vi.mocked(fs.folderConventions).mockResolvedValue(vault());
  const replaceText = vi.fn(() => true);
  vi.mocked(getWindowAccess).mockReturnValue({
    documentAt: (path: string) =>
      path === "/w/index.md"
        ? {
            text: () => "typed [p](plan.md)",
            revision: () => "r1",
            replaceText,
          }
        : null,
  } as never);
  await updateLinksAfterMove("/w/plan.md", "/w/archive/plan.md", "/w", t);
  expect(replaceText).toHaveBeenCalledWith("typed [p](archive/plan.md)", "r1");
  expect(Object.keys(written())).toEqual(["/w/archive/plan.md"]);
});

it("does nothing in a folder too broad to search", async () => {
  vi.mocked(fs.indexFolder).mockRejectedValue("TOO_BROAD");
  await updateLinksAfterMove("/plan.md", "/a/plan.md", "/", t);
  expect(showConfirm).not.toHaveBeenCalled();
});
