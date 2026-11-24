import { describe, expect, it } from "vitest";
import {
  createWebview,
  removeWebview,
  setWebviewState,
  webviewState,
} from "./webviews";

describe("a plugin page's kept state", () => {
  it("is kept for the latest code blocks only", () => {
    for (let i = 0; i < 600; i++) {
      const record = createWebview("p", "codeBlock", `/a.md\np:x:${i}`);
      setWebviewState(record.key, { i });
      removeWebview(record.id);
    }
    expect(webviewState("/a.md\np:x:0")).toBeUndefined();
    expect(webviewState("/a.md\np:x:599")).toEqual({ i: 599 });
  });

  it("stays for a view however many blocks come after", () => {
    const view = createWebview("p", "sidebar", "p:side");
    setWebviewState(view.key, "open");
    for (let i = 0; i < 600; i++) {
      const record = createWebview("p", "codeBlock", `/b.md\np:x:${i}`);
      setWebviewState(record.key, i);
      removeWebview(record.id);
    }
    expect(webviewState("p:side")).toBe("open");
  });
});
