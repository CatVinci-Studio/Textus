// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { viewHandlers } from "./broker-views";
import {
  databaseViewHandlers,
  stopPluginDatabaseViews,
} from "./broker-database-views";
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

describe("database views", () => {
  it("are listed for the plugin drawing databases, drawn by their own plugin without scripts, and go with it", async () => {
    const request = async (_method: string, params: unknown) => {
      const { data } = params as { data: { rows: { path: string }[] } };
      return `<ol>${data.rows
        .map((r) => `<li data-row="${r.path}" onclick="x()">${r.path}</li>`)
        .join("")}</ol><script>steal()</script>`;
    };
    const timeline = databaseViewHandlers({
      id: "a.timeline",
      request,
    } as unknown as PluginScope);
    const database = databaseViewHandlers({
      id: "a.database",
    } as unknown as PluginScope);
    timeline["views.registerDatabaseView"]({ id: "line", label: "Timeline" });
    expect(database["views.databaseViews"]()).toEqual([
      {
        id: "a.timeline#line",
        label: "Timeline",
        icon: null,
        plugin: "a.timeline",
      },
    ]);
    const html = await database["views.renderDatabaseView"]({
      id: "a.timeline#line",
      data: { rows: [{ path: "x.md" }], columns: [], types: {} },
    });
    expect(html).toBe('<ol><li data-row="x.md">x.md</li></ol>');
    stopPluginDatabaseViews("a.timeline");
    expect(database["views.databaseViews"]()).toEqual([]);
  });
});
