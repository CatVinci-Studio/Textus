import { describe, expect, it, vi } from "vitest";
import { resolveStrings } from "../i18n/strings";

const shown = vi.fn();
const asked = vi.fn(async (text: string) => text.length > 0);
const opened = vi.fn();
const offer = vi.fn(async (): Promise<string> => "none");
vi.mock("../engine/controls/app-dialog", () => ({
  showMessage: (text: string) => shown(text),
  showConfirm: (text: string) => asked(text),
}));
vi.mock("../platform/ipc", () => ({
  exportDoc: { openLinkedFile: (path: string) => opened(path) },
  session: {},
}));
vi.mock("../plugins/store/open-offer", () => ({ offerPluginToOpen: offer }));

const { isBinaryContent, openUnreadable } = await import("./open-unreadable");
const t = resolveStrings("en");

describe("a file that won't open as text", () => {
  it("is said to be gone when it isn't there, with no plugin offered", async () => {
    const err = new Error("No such file or directory (os error 2)");
    const opts = { reopening: false, t };
    expect(await openUnreadable("/n/Old.md", err, opts)).toBeNull();
    expect(offer).not.toHaveBeenCalled();
    expect(shown).toHaveBeenCalledWith(expect.stringContaining("isn't there"));
  });

  it("is offered to a plugin when it is there but not text", async () => {
    await openUnreadable(
      "/n/a.xyz",
      new Error("stream did not contain valid UTF-8"),
      {
        reopening: false,
        t,
      },
    );
    expect(offer).toHaveBeenCalled();
    expect(shown).toHaveBeenLastCalledWith(
      expect.stringContaining("isn't a text document"),
    );
  });

  it("says why when its plugin's offer was turned off, the system's app a press away", async () => {
    offer.mockResolvedValueOnce("muted");
    const err = new Error("stream did not contain valid UTF-8");
    const opts = { reopening: false, t };
    expect(await openUnreadable("/n/doc.pdf", err, opts)).toBeNull();
    expect(asked).toHaveBeenCalledWith(expect.stringContaining("doc.pdf"));
    expect(opened).toHaveBeenCalledWith("/n/doc.pdf");
  });

  it("knows a PDF or a zip that happens to read as text", () => {
    expect(isBinaryContent("%PDF-1.1 1 0 obj<</Type/Page>>")).toBe(true);
    expect(isBinaryContent("PK\u0003\u0004word/document.xml")).toBe(true);
    expect(isBinaryContent("<html><body>%PDF-</body></html>")).toBe(false);
  });
});
