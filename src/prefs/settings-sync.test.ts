import { describe, expect, it } from "vitest";
import { SettingsSync } from "./settings-sync";

describe("SettingsSync", () => {
  it("applies another window's change to fields it hasn't touched", () => {
    const sync = new SettingsSync({ theme: "light", zoom: 1 }, 5);
    expect(sync.remote({ theme: "dark" }, 6)).toEqual({ theme: "dark" });
    expect(sync.raw).toEqual({ theme: "dark", zoom: 1 });
  });

  it("ignores an event older than the snapshot it already has", () => {
    const sync = new SettingsSync({ theme: "dark" }, 10);
    expect(sync.remote({ theme: "light" }, 8)).toBeNull();
    expect(sync.raw.theme).toBe("dark");
  });

  it("keeps a local change until Rust has confirmed it", () => {
    const sync = new SettingsSync({ theme: "light" }, 5);
    const ticket = sync.local({ theme: "dark" });
    // Another window's earlier change, delivered after ours was made.
    expect(sync.remote({ theme: "light" }, 6)).toBeNull();
    sync.confirm(ticket, 7);
    // ...and once confirmed, only newer revisions replace it.
    expect(sync.remote({ theme: "light" }, 6)).toBeNull();
    expect(sync.remote({ theme: "light" }, 8)).toEqual({ theme: "light" });
  });

  it("leaves a field pending when it changed again after being sent", () => {
    const sync = new SettingsSync({ customCss: "" }, 1);
    const first = sync.local({ customCss: "a" });
    sync.local({ customCss: "ab" });
    sync.confirm(first, 2);
    expect(sync.remote({ customCss: "other" }, 3)).toBeNull();
    expect(sync.raw.customCss).toBe("ab");
  });

  it("stops holding a field whose send failed", () => {
    const sync = new SettingsSync({ theme: "light" }, 1);
    sync.confirm(sync.local({ theme: "dark" }));
    expect(sync.remote({ theme: "light" }, 2)).toEqual({ theme: "light" });
  });

  it("adopts a newer snapshot except fields changed since", () => {
    const sync = new SettingsSync({ theme: "light", language: "en" }, 1);
    sync.local({ language: "ja" });
    sync.remote({ zoom: 2 }, 9);
    const changed = sync.snapshot(
      { theme: "dark", language: "en", contentWidth: "full" },
      5,
    );
    expect(changed).toBe(true);
    expect(sync.raw).toEqual({
      theme: "dark",
      // Unconfirmed local change wins.
      language: "ja",
      // Newer than the snapshot.
      zoom: 2,
      contentWidth: "full",
    });
    // A stale snapshot changes nothing.
    expect(sync.snapshot({ theme: "light" }, 4)).toBe(false);
  });
});
