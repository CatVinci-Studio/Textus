import { describe, expect, it, vi } from "vitest";
import { resolveStrings } from "../i18n/strings";

const shown = vi.fn();
const offer = vi.fn(async () => "none");
vi.mock("../engine/controls/app-dialog", () => ({
  showMessage: (text: string) => shown(text),
}));
vi.mock("../plugins/store/open-offer", () => ({ offerPluginToOpen: offer }));

const { openUnreadable } = await import("./open-unreadable");
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
});
