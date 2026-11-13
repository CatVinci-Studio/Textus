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

/** The jobs for a change from `before` to `after` (maps of file to text;
 *  files missing from either side don't exist there). */
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

const NONE = { light: false, native: false };
const LIGHT = { light: true, native: false };
const NATIVE = { light: false, native: true };

describe("which CI jobs a pull request needs", () => {
  it("runs check alone for documentation", () => {
    expect(
      edit(["docs/dev/testing.md", "README.md", "packaging/arch/README.md"]),
    ).toEqual(NONE);
  });

  it("runs the light check alone for GitHub's settings, the license and root Markdown, merged too", () => {
    const files = [
      ".github/FUNDING.yml",
      ".github/CODEOWNERS",
      ".github/dependabot.yml",
      ".github/ISSUE_TEMPLATE/bug.yml",
      ".github/pull_request_template.md",
      "LICENSE",
      "CONTRIBUTING.md",
      "README.zh.md",
    ];
    expect(edit(files)).toEqual(LIGHT);
    expect(edit(files, { push: true })).toEqual(LIGHT);
    for (const file of [
      ".github/workflows/ci.yml",
      ".github/actions/e2e-setup/action.yml",
      "docs/dev/plugins/reference.md",
      ".prettierrc",
      "knip.json",
    ])
      expect(edit([file]).light, file).toBe(false);
    expect(edit([".github/FUNDING.yml", "src/main.tsx"]).light).toBe(false);
    const embedded = classify({
      files: ["NOTES.md"],
      push: false,
      read: () => ["a\n", "b\n"],
      rustReads: ["NOTES.md"],
    });
    expect(embedded).toEqual(NATIVE);
  });

  it("runs native for the Markdown skills Rust embeds", () => {
    expect(
      edit([
        "src-tauri/src/ai/skills/de-ai.md",
        "src-tauri/src/ai/skills/packs/README.md",
      ]),
    ).toEqual(NATIVE);
  });

  it("runs check alone for the Markdown the frontend imports", () => {
    expect(
      edit([
        "src/help/markdown-guide.en.md",
        "src/playground/samples/zh.md",
        "src/theme/fixtures/theme-skill-reply.md",
      ]),
    ).toEqual(NONE);
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

  it("runs check alone for a frontend change", () => {
    expect(
      edit(["src/editor/editor.ts", "e2e/writing.spec.ts", "vite.config.ts"]),
    ).toEqual(NONE);
  });

  it("runs native alone for a Rust change", () => {
    expect(
      edit([
        "src-tauri/src/lib.rs",
        "src-tauri/crates/aicompat/src/lib.rs",
        "src-tauri/rust-toolchain.toml",
        "scripts/ios-prepare.sh",
        "scripts/smoke-ios-sim.sh",
      ]),
    ).toEqual(NATIVE);
  });

  it("runs native for the generated bindings, which a Rust test compares", () => {
    expect(edit(["src/platform/bindings/app.ts"])).toEqual(NATIVE);
  });

  it("runs native for a frontend file the Rust tests embed", () => {
    expect(rustReads).toContain("index.html");
    expect(rustReads).toContain("src/registry/menu/menu.json");
    expect(edit(["src/registry/menu/menu.json"])).toEqual(NATIVE);
  });

  it("runs native for the src-tauri files the browser sees", () => {
    for (const file of [
      "src-tauri/icons/128x128.png",
      "src-tauri/src/boot.js",
      "src-tauri/tauri.conf.json",
      "src-tauri/tauri.ios.conf.json",
    ]) {
      expect(edit([file]), file).toEqual(NATIVE);
    }
  });

  it("runs native for a change to both sides", () => {
    expect(edit(["src/main.tsx", "src-tauri/src/lib.rs"])).toEqual(NATIVE);
  });

  it("runs native for a workflow or Node version change", () => {
    expect(edit([".github/workflows/ci.yml"])).toEqual(NATIVE);
    expect(edit([".nvmrc"])).toEqual(NATIVE);
  });

  it("ignores a bump's version lines in a mixed change", () => {
    const after = { ...bumped, "src/main.tsx": "b\n" };
    expect(change({ ...current, "src/main.tsx": "a\n" }, after)).toEqual(NONE);
  });

  it("runs native when the npm dependencies change", () => {
    const pkg = JSON.parse(bumped["package.json"]);
    pkg.dependencies["left-pad"] = "^1.3.0";
    const after = { ...bumped, "package.json": JSON.stringify(pkg, null, 2) };
    expect(change(current, after)).toEqual(NATIVE);
  });

  it("runs native when the lockfile adds a package", () => {
    const lock = JSON.parse(current["package-lock.json"]);
    lock.packages["node_modules/left-pad"] = { version: "1.3.0" };
    const file = "package-lock.json";
    expect(
      change(
        { [file]: current[file] },
        { [file]: JSON.stringify(lock, null, 2) },
      ),
    ).toEqual(NATIVE);
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

  it("runs native when a version file is added or removed", () => {
    expect(change({}, { "package.json": "{}" })).toEqual(NATIVE);
    expect(change({ "package.json": "{}" }, {})).toEqual(NATIVE);
  });
});

describe("which CI jobs a push needs", () => {
  it("runs check alone for a version bump", () => {
    expect(change(current, bumped, { push: true })).toEqual(NONE);
  });

  it("runs native otherwise, documentation and Rust alone included", () => {
    for (const file of ["docs/dev/testing.md", "src-tauri/src/lib.rs"]) {
      expect(edit([file], { push: true }), file).toEqual(NATIVE);
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
