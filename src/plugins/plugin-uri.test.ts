import { describe, expect, it } from "vitest";
import { parsePluginUri } from "./plugin-uri";

describe("parsePluginUri", () => {
  it("names the plugin and gives it the path and query", () => {
    expect(
      parsePluginUri("textus://catvinci.zotero/item?key=AB12&page=3"),
    ).toEqual({
      plugin: "catvinci.zotero",
      path: "/item",
      query: { key: "AB12", page: "3" },
    });
  });

  it("decodes the path, and gives / when there is none", () => {
    expect(parsePluginUri("textus://a.b/clip%20this")?.path).toBe("/clip this");
    expect(parsePluginUri("textus://a.b")?.path).toBe("/");
  });

  it("takes nothing that isn't a link for a plugin", () => {
    expect(parsePluginUri("https://a.b/x")).toBeNull();
    expect(parsePluginUri("textus://noperiod/x")).toBeNull();
    expect(parsePluginUri("not a url")).toBeNull();
  });
});
