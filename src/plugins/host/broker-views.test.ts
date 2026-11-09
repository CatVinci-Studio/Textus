import { describe, expect, it } from "vitest";
import { viewHandlers } from "./broker-views";
import type { PluginScope } from "./broker-scope";
import { createWebview, removeWebview, webview } from "../views/webviews";

function scopeOf(id: string): PluginScope {
  return {
    id,
    ownWebview: (wv: string) => {
      const record = webview(wv);
      if (!record || record.plugin !== id) throw new Error(`No webview ${wv}.`);
      return record;
    },
  } as unknown as PluginScope;
}

describe("webview.postMessage", () => {
  it("answers false for a view closed meanwhile, without throwing", () => {
    const record = createWebview("a.plugin", "view", "k-closed");
    removeWebview(record.id);
    const post = viewHandlers(scopeOf("a.plugin"))["webview.postMessage"];
    expect(post({ webview: record.id, message: { x: 1 } })).toBe(false);
  });

  it("still refuses another plugin's view", () => {
    const record = createWebview("b.plugin", "view", "k-other");
    const post = viewHandlers(scopeOf("a.plugin"))["webview.postMessage"];
    expect(() => post({ webview: record.id, message: 1 })).toThrow();
    removeWebview(record.id);
  });
});
