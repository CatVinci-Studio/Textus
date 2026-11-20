import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  LICENSES_FILE,
  chosenLicenses,
  noticesMarkdown,
  packageDirOf,
  shippedCrates,
  splitCopyright,
  type ThirdParty,
} from "./vite.third-party-notices";

const MIT = (holder: string) =>
  `MIT License\n\nCopyright (c) ${holder}\n\nPermission is hereby granted, free of charge.`;

const pkg = (over: Partial<ThirdParty>): ThirdParty => ({
  name: "a",
  version: "1.0.0",
  license: "MIT",
  texts: [],
  notices: [],
  ...over,
});

describe("third-party notices", () => {
  it("is written where Settings › About reads it", () => {
    expect(readFileSync("src/help/licenses.ts", "utf8")).toContain(
      `"${LICENSES_FILE}"`,
    );
  });

  it("finds the package a bundled module comes from, scoped or not", () => {
    expect(packageDirOf("/app/node_modules/katex/dist/katex.mjs")).toBe(
      "/app/node_modules/katex",
    );
    expect(
      packageDirOf("/app/node_modules/a/node_modules/@b/c/index.js?v=1"),
    ).toBe("/app/node_modules/a/node_modules/@b/c");
    expect(packageDirOf("/app/src/main.tsx")).toBeNull();
  });

  it("takes one license of a choice and all of a combination", () => {
    expect(chosenLicenses("Apache-2.0 OR MIT")).toEqual(["MIT"]);
    expect(chosenLicenses("(MIT OR Apache-2.0) AND Unicode-3.0")).toEqual([
      "MIT",
      "Unicode-3.0",
    ]);
    expect(chosenLicenses("MIT/Apache-2.0")).toEqual(["MIT"]);
    expect(chosenLicenses("Apache-2.0 WITH LLVM-exception OR MIT")).toEqual([
      "MIT",
    ]);
  });

  it("keeps each package's copyright lines and the text they share once", () => {
    const { body, copyright } = splitCopyright(MIT("2020 Ann"));
    expect(copyright).toEqual(["Copyright (c) 2020 Ann"]);
    expect(body).not.toMatch(/Ann/);
    const md = noticesMarkdown(
      [
        pkg({ name: "b", texts: [MIT("2021 Bo")] }),
        pkg({ name: "a", texts: [MIT("2020 Ann")] }),
      ],
      "# Third-party notices\n\nCopied code.",
      () => undefined,
    );
    expect(md.match(/Permission is hereby granted/g)).toHaveLength(1);
    expect(md).toMatch(/- a 1\.0\.0 \(MIT\)\s+Copyright \(c\) 2020 Ann\n- b/);
    expect(md).toContain("Copied code.");
  });

  it("gives a package without a license file its license's standard text, and carries NOTICE files", () => {
    const md = noticesMarkdown(
      [
        pkg({
          name: "z",
          license: "Zlib OR Apache-2.0",
          authors: ["Zed"],
          notices: ["Z\nCopyright Zed"],
        }),
      ],
      "",
      (id) => (id === "Zlib" ? "zlib text" : undefined),
    );
    expect(md).toContain("Copyright (c) Zed");
    expect(md).toContain("zlib text");
    expect(md).toMatch(/## NOTICE files\n\n### z 1\.0\.0/);
  });

  it("refuses a package with no license or one that would bind Textus's code", () => {
    const build = (license: string) => () =>
      noticesMarkdown([pkg({ license, texts: ["x"] })], "", () => "x");
    expect(build("GPL-3.0-only")).toThrow(/GPL-3\.0-only/);
    expect(() =>
      noticesMarkdown([pkg({ license: "" })], "", () => undefined),
    ).toThrow(/no license/);
  });

  it("counts only the crates compiled into the app", () => {
    const crate = (id: string, kind = "lib") => ({
      id,
      name: id,
      version: "1.0.0",
      license: "MIT",
      license_file: null,
      repository: null,
      authors: [],
      manifest_path: `/nowhere/${id}/Cargo.toml`,
      targets: [{ kind: [kind] }],
    });
    const dep = (pkg: string, kind: string | null = null) => ({
      pkg,
      dep_kinds: [{ kind }],
    });
    const names = shippedCrates({
      packages: [
        crate("app"),
        crate("own"),
        crate("lib"),
        crate("deep"),
        crate("macro", "proc-macro"),
        crate("builder"),
        crate("tester"),
      ],
      workspace_members: ["app", "own"],
      resolve: {
        root: "app",
        nodes: [
          {
            id: "app",
            deps: [
              dep("own"),
              dep("lib"),
              dep("macro"),
              dep("builder", "build"),
              dep("tester", "dev"),
            ],
          },
          { id: "lib", deps: [dep("deep")] },
        ],
      },
    }).map((c) => c.name);
    expect(names.sort()).toEqual(["deep", "lib"]);
  });
});
