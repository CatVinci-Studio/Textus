import { describe, expect, it } from "vitest";
import { renamedGrants } from "./migrate-official";

describe("renamedGrants", () => {
  it("carries the API before 1.0's permissions over to their new names", () => {
    expect(
      renamedGrants([
        "document.read",
        "document.propose",
        "workspace.read",
        "workspace.write",
        "network:api.zotero.org",
      ]),
    ).toEqual([
      "editor.read",
      "editor.propose",
      "files.read",
      "files.write",
      "network:api.zotero.org",
    ]);
  });

  it("keeps a permission granted under both names once", () => {
    expect(renamedGrants(["files.read", "workspace.read"])).toEqual([
      "files.read",
    ]);
  });
});
