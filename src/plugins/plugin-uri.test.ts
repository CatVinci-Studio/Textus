import { describe, expect, it } from "vitest";
import { parseTextusUri } from "./plugin-uri";

describe("parseTextusUri", () => {
  it("names the plugin and gives it the path and query", () => {
    expect(
      parseTextusUri("textus://catvinci.zotero/item?key=AB12&page=3"),
    ).toEqual({
      kind: "plugin",
      plugin: "catvinci.zotero",
      path: "/item",
      query: { key: "AB12", page: "3" },
    });
  });

  it("decodes the path, and gives / when there is none", () => {
    const path = (link: string) => {
      const uri = parseTextusUri(link);
      return uri?.kind === "plugin" ? uri.path : null;
    };
    expect(path("textus://a.b/clip%20this")).toBe("/clip this");
    expect(path("textus://a.b")).toBe("/");
  });

  it("reads a command link: the command, and its query", () => {
    expect(parseTextusUri("textus://command/jane.count.run?scope=all")).toEqual(
      {
        kind: "command",
        command: "jane.count.run",
        query: { scope: "all" },
      },
    );
    expect(parseTextusUri("textus://command/")).toBeNull();
    expect(parseTextusUri("textus://command/a b")).toBeNull();
  });

  it("takes nothing that isn't a link it knows", () => {
    expect(parseTextusUri("https://a.b/x")).toBeNull();
    expect(parseTextusUri("textus://noperiod/x")).toBeNull();
    expect(parseTextusUri("not a url")).toBeNull();
  });
});
