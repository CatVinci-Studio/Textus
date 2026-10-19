import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { classify } from "./ci-changes.mjs";

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

/** The real files as a bump to 9.9.9 leaves them: the app's version
 *  replaced where it appears, the way PRs like #192 change it. */
const bumped = Object.fromEntries(
  VERSION_FILES.map((file) => [
    file,
    file === "src-tauri/Cargo.lock"
      ? current[file].replace(
          `name = "textus"\nversion = "${version}"`,
          'name = "textus"\nversion = "9.9.9"',
        )
      : current[file].replaceAll(`"${version}"`, '"9.9.9"'),
  ]),
);

/** A change from `before` to `after` (maps of file to text); files missing
 *  from either side don't exist there. */
function change(before, after, { push = false } = {}) {
  const files = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  return classify({
    files,
    push,
    read: (file) => [before[file] ?? null, after[file] ?? null],
  });
}

const edited = (file) => ({
  before: { [file]: "a\n" },
  after: { [file]: "b\n" },
});

describe("which CI jobs a change needs", () => {
  it("runs check alone for documentation", () => {
    const { before, after } = edited("docs/dev/testing.md");
    expect(change(before, after)).toEqual({ code: false, frontend: false });
  });

  it("runs check alone for a version bump, on the pull request and on its push", () => {
    expect(bumped["src-tauri/Cargo.lock"]).not.toBe(
      current["src-tauri/Cargo.lock"],
    );
    const off = { code: false, frontend: false };
    expect(change(current, bumped)).toEqual(off);
    expect(change(current, bumped, { push: true })).toEqual(off);
  });

  it("runs everything when a bump also adds an npm dependency", () => {
    const pkg = JSON.parse(bumped["package.json"]);
    pkg.dependencies["left-pad"] = "^1.3.0";
    const after = { ...bumped, "package.json": JSON.stringify(pkg, null, 2) };
    expect(change(current, after)).toEqual({ code: true, frontend: true });
  });

  it("runs everything when a bump also changes the lockfile's packages", () => {
    const lock = JSON.parse(bumped["package-lock.json"]);
    lock.packages["node_modules/left-pad"] = { version: "1.3.0" };
    const after = {
      ...bumped,
      "package-lock.json": JSON.stringify(lock, null, 2),
    };
    expect(change(current, after).code).toBe(true);
  });

  it("runs everything when a bump also adds a Rust dependency", () => {
    const after = {
      ...bumped,
      "src-tauri/Cargo.toml": bumped["src-tauri/Cargo.toml"].replace(
        "[dependencies]\n",
        '[dependencies]\nleft-pad = "1"\n',
      ),
    };
    expect(after["src-tauri/Cargo.toml"]).not.toBe(
      bumped["src-tauri/Cargo.toml"],
    );
    expect(change(current, after).code).toBe(true);
  });

  it("runs everything when Cargo.lock moves another package's version", () => {
    const lock = current["src-tauri/Cargo.lock"];
    const other = lock.match(/name = "serde"\nversion = "([^"]+)"/);
    const after = {
      "src-tauri/Cargo.lock": lock.replace(
        other[0],
        'name = "serde"\nversion = "0.0.1"',
      ),
    };
    expect(change({ "src-tauri/Cargo.lock": lock }, after)).toEqual({
      code: true,
      frontend: false,
    });
  });

  it("skips e2e for a pull request that only changes the Rust backend", () => {
    const { before, after } = edited("src-tauri/src/lib.rs");
    expect(change(before, after)).toEqual({ code: true, frontend: false });
  });

  it("runs e2e for the src-tauri files the browser sees", () => {
    for (const file of [
      "src-tauri/icons/128x128.png",
      "src-tauri/src/boot.js",
      "src-tauri/tauri.conf.json",
      "src-tauri/tauri.ios.conf.json",
    ]) {
      const { before, after } = edited(file);
      expect(change(before, after), file).toEqual({
        code: true,
        frontend: true,
      });
    }
  });

  it("runs everything on a push that isn't a bump", () => {
    for (const file of ["src-tauri/src/lib.rs", "docs/dev/testing.md"]) {
      const { before, after } = edited(file);
      expect(change(before, after, { push: true }), file).toEqual({
        code: true,
        frontend: true,
      });
    }
  });

  it("runs everything when a version file is added or removed", () => {
    expect(change({}, { "package.json": "{}" }).code).toBe(true);
    expect(change({ "package.json": "{}" }, {}).code).toBe(true);
  });
});
