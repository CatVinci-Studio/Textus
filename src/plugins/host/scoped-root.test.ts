import { describe, expect, it, vi } from "vitest";
import { readableRoot } from "./scoped-root";

const notices = vi.hoisted(() => [] as string[]);
vi.mock("../../platform/capabilities", async (real) => ({
  ...(await real<typeof import("../../platform/capabilities")>()),
  isIOSApp: false,
  isMobileApp: true,
}));
vi.mock("../../engine/controls/notices", () => ({
  showNotice: (text: string) => void notices.push(text),
}));

describe("a plugin's folder on Android", () => {
  it("is refused, said once, when Android opened it without access to all files", () => {
    expect(readableRoot("/storage/emulated/0/Notes")).toBe(
      "/storage/emulated/0/Notes",
    );
    const tree = "content://com.android.externalstorage.documents/tree/x";
    expect(() => readableRoot(tree)).toThrow(/access to all files/);
    expect(() => readableRoot(tree)).toThrow(/access to all files/);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatch(/Continue/);
  });
});
