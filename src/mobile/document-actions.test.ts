import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveStrings } from "../i18n/strings";

const calls = vi.hoisted(() => ({
  links: vi.fn(),
  plugin: vi.fn(),
}));
vi.mock("../engine/controls/app-dialog", () => ({
  showPrompt: async () => "Trip.md",
  showConfirm: async () => true,
  showMessage: vi.fn(),
}));
vi.mock("../document/ios-recents", () => ({
  renameIOSDocument: async (_from: string, name: string) => `/d/${name}`,
  deleteIOSDocument: async () => {},
}));
vi.mock("../files/move-links", () => ({ updateLinksAfterMove: calls.links }));
vi.mock("../plugins/app-bridge", () => ({ emitPluginEvent: calls.plugin }));

const { deleteDocument, renameDocument } = await import("./document-actions");
const t = resolveStrings("en");
beforeEach(() => vi.clearAllMocks());

describe("the phone's document list", () => {
  it("renames as the file tree does: tabs follow and links to it are rewritten", async () => {
    const moved = vi.fn();
    expect(await renameDocument("/d/Plan.md", t, moved)).toBe(true);
    expect(moved).toHaveBeenCalledWith("/d/Plan.md", "/d/Trip.md");
    expect(calls.links).toHaveBeenCalledWith(
      "/d/Plan.md",
      "/d/Trip.md",
      "/d",
      t,
    );
  });

  it("deletes as the file tree does: plugins hear of it", async () => {
    const deleted = vi.fn();
    expect(await deleteDocument("/d/Plan.md", t, deleted)).toBe(true);
    expect(deleted).toHaveBeenCalledWith("/d/Plan.md");
    expect(calls.plugin).toHaveBeenCalledWith("fileDelete", {
      path: "/d/Plan.md",
    });
  });
});
