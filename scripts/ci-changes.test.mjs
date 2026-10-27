import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { classify, reachesSaving, rustIncludes } from "./ci-changes.mjs";

const VERSION_FILES = [
  "package.json",
  "package-lock.json",
  "src-tauri/Cargo.toml",
  "src-tauri/Cargo.lock",
  "src-tauri/tauri.conf.json",
];
const version = JSON.parse(readFileSync("package.json", "utf8")).version;
const current = Object.fromEntries(
  VERSION_FILES.map((file) => [file, readFileSync(file, "utf8")]),
);

/** The real files as a bump to 9.9.9 leaves them: only the app's own
 *  version lines. A dependency with the same version must stay as it is. */
const bumpedLock = JSON.parse(current["package-lock.json"]);
bumpedLock.version = "9.9.9";
bumpedLock.packages[""].version = "9.9.9";
const bumped = {
  "package.json": current["package.json"].replace(
    `"version": "${version}"`,
    '"version": "9.9.9"',
  ),
  "package-lock.json": `${JSON.stringify(bumpedLock, null, 2)}\n`,
  "src-tauri/Cargo.toml": current["src-tauri/Cargo.toml"].replace(
    `version = "${version}"`,
    'version = "9.9.9"',
  ),
  "src-tauri/Cargo.lock": current["src-tauri/Cargo.lock"].replace(
    `name = "textus"\nversion = "${version}"`,
    'name = "textus"\nversion = "9.9.9"',
  ),
  "src-tauri/tauri.conf.json": current["src-tauri/tauri.conf.json"].replace(
    `"version": "${version}"`,
    '"version": "9.9.9"',
  ),
};

const rustReads = rustIncludes();

/** A change from `before` to `after` (maps of file to text); files missing
 *  from either side don't exist there. */
function change(before, after, { push = false } = {}) {
  const files = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  return classify({
    files,
    push,
    read: (file) => [before[file] ?? null, after[file] ?? null],
    rustReads,
  });
}

/** Each of `files` edited from "a" to "b". */
function edit(files, options) {
  const side = (text) => Object.fromEntries(files.map((f) => [f, text]));
  return change(side("a\n"), side("b\n"), options);
}

const NONE = { e2e: false, native: false };
const ALL = { e2e: true, native: true };
const E2E = { e2e: true, native: false };
const NATIVE = { e2e: false, native: true };

describe("which CI jobs a pull request needs", () => {
  it("runs check alone for documentation", () => {
    expect(
      edit([
        "docs/dev/testing.md",
        "README.md",
        "packaging/arch/README.md",
        ".github/pull_request_template.md",
        "LICENSE",
      ]),
    ).toEqual(NONE);
  });

  it("runs native for the Markdown skills Rust embeds", () => {
    expect(
      edit([
        "src-tauri/src/ai/skills/de-ai.md",
        "src-tauri/src/ai/skills/packs/README.md",
      ]),
    ).toEqual(NATIVE);
  });

  it("runs e2e for the Markdown the frontend imports", () => {
    expect(
      edit([
        "src/help/markdown-guide.en.md",
        "src/playground/samples/zh.md",
        "src/theme/fixtures/theme-skill-reply.md",
      ]),
    ).toEqual(E2E);
  });

  it("runs native for Markdown outside src-tauri/ that Rust embeds", () => {
    const change = classify({
      files: ["notes/prompt.md"],
      push: false,
      read: () => ["a\n", "b\n"],
      rustReads: ["notes/prompt.md"],
    });
    expect(change.native).toBe(true);
  });

  it("runs check alone for a version bump", () => {
    expect(bumped["src-tauri/Cargo.lock"]).not.toBe(
      current["src-tauri/Cargo.lock"],
    );
    expect(change(current, bumped)).toEqual(NONE);
  });

  it("runs e2e alone for a frontend change", () => {
    expect(
      edit(["src/editor/editor.ts", "e2e/writing.spec.ts", "vite.config.ts"]),
    ).toEqual(E2E);
  });

  it("runs native alone for a Rust change", () => {
    expect(
      edit([
        "src-tauri/src/lib.rs",
        "src-tauri/crates/aicompat/src/lib.rs",
        "src-tauri/rust-toolchain.toml",
        "scripts/ios-prepare.sh",
      ]),
    ).toEqual(NATIVE);
  });

  it("runs both for the generated bindings, which a Rust test compares", () => {
    expect(edit(["src/platform/bindings/app.ts"])).toEqual(ALL);
  });

  it("runs both for a frontend file the Rust tests embed", () => {
    expect(rustReads).toContain("index.html");
    expect(rustReads).toContain("src/app/menu/app-menu-model.ts");
    expect(edit(["src/app/menu/app-menu-model.ts"])).toEqual(ALL);
  });

  it("runs both for the src-tauri files the browser sees", () => {
    for (const file of [
      "src-tauri/icons/128x128.png",
      "src-tauri/src/boot.js",
      "src-tauri/tauri.conf.json",
      "src-tauri/tauri.ios.conf.json",
    ]) {
      expect(edit([file]), file).toEqual(ALL);
    }
  });

  it("runs both for a change to both sides", () => {
    expect(edit(["src/main.tsx", "src-tauri/src/lib.rs"])).toEqual(ALL);
  });

  it("runs everything for a workflow or Node version change", () => {
    expect(edit([".github/workflows/ci.yml"])).toEqual(ALL);
    expect(edit([".nvmrc"])).toEqual(ALL);
  });

  it("ignores a bump's version lines in a mixed change", () => {
    const after = { ...bumped, "src/main.tsx": "b\n" };
    expect(change({ ...current, "src/main.tsx": "a\n" }, after)).toEqual(E2E);
  });

  it("runs everything when the npm dependencies change", () => {
    const pkg = JSON.parse(bumped["package.json"]);
    pkg.dependencies["left-pad"] = "^1.3.0";
    const after = { ...bumped, "package.json": JSON.stringify(pkg, null, 2) };
    expect(change(current, after)).toEqual(ALL);
  });

  it("runs everything when the lockfile adds a package", () => {
    const lock = JSON.parse(current["package-lock.json"]);
    lock.packages["node_modules/left-pad"] = { version: "1.3.0" };
    const file = "package-lock.json";
    expect(
      change(
        { [file]: current[file] },
        { [file]: JSON.stringify(lock, null, 2) },
      ),
    ).toEqual(ALL);
  });

  it("runs native when a bump also adds a Rust dependency", () => {
    const toml = bumped["src-tauri/Cargo.toml"].replace(
      "[dependencies]\n",
      '[dependencies]\nleft-pad = "1"\n',
    );
    expect(toml).not.toBe(bumped["src-tauri/Cargo.toml"]);
    const after = { ...bumped, "src-tauri/Cargo.toml": toml };
    expect(change(current, after)).toEqual(NATIVE);
  });

  it("runs native when Cargo.lock moves another package's version", () => {
    const file = "src-tauri/Cargo.lock";
    const other = current[file].match(/name = "serde"\nversion = "[^"]+"/)[0];
    const after = current[file].replace(
      other,
      'name = "serde"\nversion = "0.0.1"',
    );
    expect(change({ [file]: current[file] }, { [file]: after })).toEqual(
      NATIVE,
    );
  });

  it("runs everything when a version file is added or removed", () => {
    expect(change({}, { "package.json": "{}" })).toEqual(ALL);
    expect(change({ "package.json": "{}" }, {})).toEqual(ALL);
  });
});

describe("which CI jobs a push needs", () => {
  it("runs check alone for a version bump", () => {
    expect(change(current, bumped, { push: true })).toEqual(NONE);
  });

  it("runs everything otherwise, documentation and Rust alone included", () => {
    for (const file of ["docs/dev/testing.md", "src-tauri/src/lib.rs"]) {
      expect(edit([file], { push: true }), file).toEqual(ALL);
    }
  });
});

describe("the save round trip in CI", () => {
  const runs = (...files) => reachesSaving({ files, push: false });

  it("runs for a change to the editor, the document code or the dependencies", () => {
    expect(runs("src/editor/markdown/markdown-output.ts")).toBe(true);
    expect(runs("src/document-view/useDocumentReporting.ts")).toBe(true);
    expect(runs("src/document/file-format.ts")).toBe(true);
    expect(runs("package-lock.json")).toBe(true);
  });

  it("runs for a change to the documents it reads", () => {
    expect(runs("docs/design/ai-eval.md")).toBe(true);
    expect(runs("src/help/markdown-guide.en.md")).toBe(true);
  });

  it("skips a change that can't reach saving", () => {
    expect(runs("src-tauri/src/main.rs")).toBe(false);
    expect(runs("src/sidebar/Sidebar.tsx", "README.md")).toBe(false);
  });

  it("always runs on a push", () => {
    expect(reachesSaving({ files: ["README.md"], push: true })).toBe(true);
  });
});
