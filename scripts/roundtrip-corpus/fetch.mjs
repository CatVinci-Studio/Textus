#!/usr/bin/env node
// Downloads the real-document corpus the save round-trip test runs on
// (src/document-view/save-roundtrip-corpus.test.ts, docs/dev/saving.md):
// a few thousand Markdown files of varied style, into .cache/roundtrip-corpus
// (gitignored). None of it is committed; the sources and their licences are
// listed below and written to the manifest.
//
//   node scripts/roundtrip-corpus/fetch.mjs     (again to refresh)
//
// The files are untrusted data. Nothing in them is run: the repositories
// are shallow clones with LFS and submodules left out, each in its own
// folder, read as text only, and symbolic links are skipped.
import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const cache = join(root, ".cache/roundtrip-corpus");
const sources = join(cache, "sources");

/**
 * Each source: a shallow clone of `repo` (only `sparse` when given), or the
 * `examples` of a spec file at `url`, or single `files` by URL. `take`
 * picks at most that many files, evenly spaced over the sorted list, so a
 * huge repository doesn't crowd out the rest.
 */
const SOURCES = [
  // Docs-heavy projects.
  {
    name: "rust-book",
    repo: "https://github.com/rust-lang/book",
    licence: "MIT OR Apache-2.0",
    sparse: ["/src/**/*.md"],
  },
  {
    name: "rust-by-example",
    repo: "https://github.com/rust-lang/rust-by-example",
    licence: "MIT OR Apache-2.0",
    sparse: ["/src/**/*.md"],
  },
  {
    name: "mdn-content",
    repo: "https://github.com/mdn/content",
    licence: "CC-BY-SA-2.5",
    sparse: [
      "/files/en-us/web/javascript/guide/**/*.md",
      "/files/en-us/web/javascript/reference/statements/**/*.md",
      "/files/en-us/web/css/reference/properties/**/*.md",
    ],
    take: 400,
  },
  {
    name: "tldr",
    repo: "https://github.com/tldr-pages/tldr",
    licence: "CC-BY-4.0",
    sparse: ["/pages/common/*.md", "/pages.zh/common/*.md"],
    take: 400,
  },
  // Awesome lists: long nested link lists.
  {
    name: "awesome",
    repo: "https://github.com/sindresorhus/awesome",
    licence: "CC0-1.0",
  },
  {
    name: "awesome-python",
    repo: "https://github.com/vinta/awesome-python",
    licence: "CC-BY-4.0",
  },
  {
    name: "free-programming-books",
    repo: "https://github.com/EbookFoundation/free-programming-books",
    licence: "CC-BY-4.0",
  },
  // Chinese-language technical writing.
  {
    name: "es6tutorial",
    repo: "https://github.com/ruanyf/es6tutorial",
    licence: "CC-BY-NC-4.0",
    sparse: ["/docs/*.md", "/*.md"],
  },
  {
    name: "docsify-zh",
    repo: "https://github.com/docsifyjs/docs-zh",
    licence: "MIT",
  },
  // Academic writing with maths (and Chinese).
  {
    name: "d2l-zh",
    repo: "https://github.com/d2l-ai/d2l-zh",
    licence: "Apache-2.0",
    sparse: ["/chapter_*/*.md", "/*.md"],
  },
  {
    name: "pandoc",
    repo: "https://github.com/jgm/pandoc",
    licence: "GPL-2.0-or-later",
    sparse: ["/MANUAL.txt", "/test/*.md", "/test/command/*.md"],
    extensions: [".md", ".txt"],
    take: 400,
  },
  // Obsidian-style notes: wikilinks, #tags, callouts, front matter.
  {
    name: "kepano-obsidian",
    repo: "https://github.com/kepano/kepano-obsidian",
    licence: "MIT",
  },
  // The specs' examples, one file each.
  {
    name: "commonmark-spec",
    url: "https://raw.githubusercontent.com/commonmark/commonmark-spec/master/spec.txt",
    licence: "CC-BY-SA-4.0",
    examples: true,
  },
  {
    name: "gfm-spec",
    url: "https://raw.githubusercontent.com/github/cmark-gfm/master/test/spec.txt",
    licence: "CC-BY-SA-4.0",
    examples: true,
  },
  // Popular READMEs, each under its own repository's licence.
  {
    name: "readmes",
    licence: "each repository's own",
    files: [
      "facebook/react",
      "microsoft/vscode",
      "vuejs/core",
      "denoland/deno",
      "ohmyzsh/ohmyzsh",
      "kamranahmedse/developer-roadmap",
      "public-apis/public-apis",
      "donnemartin/system-design-primer",
      "jwasham/coding-interview-university",
      "tensorflow/tensorflow",
      "pytorch/pytorch",
      "golang/go",
      "rust-lang/rust",
      "neovim/neovim",
      "tauri-apps/tauri",
      "excalidraw/excalidraw",
      "obsidianmd/obsidian-releases",
      "jgm/pandoc",
      "commonmark/commonmark.js",
      "remarkjs/remark",
      "Milkdown/milkdown",
      "typora/typora-issues",
      "github/gitignore",
      "trekhleb/javascript-algorithms",
      "TheAlgorithms/Python",
      "justjavac/free-programming-books-zh_CN",
      "521xueweihan/HelloGitHub",
      "PanJiaChen/vue-element-admin",
      "ant-design/ant-design",
      "apache/echarts",
    ].map((repo) => `https://raw.githubusercontent.com/${repo}/HEAD/README.md`),
  },
];

function git(args, cwd) {
  execFileSync("git", args, {
    cwd,
    stdio: ["ignore", "ignore", "inherit"],
    env: {
      ...process.env,
      GIT_LFS_SKIP_SMUDGE: "1",
      GIT_TERMINAL_PROMPT: "0",
    },
  });
}

/** A fresh folder for `name`; an older download is moved aside, not
 *  deleted. */
function freshFolder(name) {
  const dir = join(sources, name);
  if (existsSync(dir)) {
    const old = join(cache, "old", `${name}-${Date.now()}`);
    mkdirSync(dirname(old), { recursive: true });
    renameSync(dir, old);
  }
  mkdirSync(dir, { recursive: true });
  return dir;
}

function clone(source) {
  const dir = freshFolder(source.name);
  const checkout = join(dir, "repo");
  const config = [
    "-c",
    "core.symlinks=false",
    "-c",
    "protocol.file.allow=never",
  ];
  if (source.sparse) {
    git(
      [
        ...config,
        "clone",
        "--quiet",
        "--depth=1",
        "--filter=blob:none",
        "--no-checkout",
        source.repo,
        checkout,
      ],
      dir,
    );
    git(["sparse-checkout", "set", "--no-cone", ...source.sparse], checkout);
    git([...config, "checkout", "--quiet"], checkout);
  } else {
    git(
      [...config, "clone", "--quiet", "--depth=1", source.repo, checkout],
      dir,
    );
  }
  return checkout;
}

async function download(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response.text();
}

/** The examples of a CommonMark-style spec, each the Markdown of one
 *  example (tabs are written "→" in the spec). */
function specExamples(spec) {
  const fence = "`".repeat(32);
  const examples = [];
  const pattern = new RegExp(
    `^${fence} example[^\\n]*\\n([\\s\\S]*?)^\\.\\n[\\s\\S]*?^${fence}$`,
    "gm",
  );
  for (const match of spec.matchAll(pattern))
    examples.push(match[1].replaceAll("→", "\t"));
  return examples;
}

function markdownFiles(dir, extensions) {
  const found = [];
  const walk = (folder) => {
    for (const entry of readdirSync(folder)) {
      if (entry === ".git") continue;
      const path = join(folder, entry);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) walk(path);
      else if (
        stat.isFile() &&
        extensions.some((ext) => entry.toLowerCase().endsWith(ext))
      )
        found.push(path);
    }
  };
  walk(dir);
  return found.sort();
}

function evenly(list, take) {
  if (!take || list.length <= take) return list;
  return Array.from(
    { length: take },
    (_, i) => list[Math.floor((i * list.length) / take)],
  );
}

const only = process.argv.slice(2);
mkdirSync(sources, { recursive: true });
const manifestPath = join(cache, "manifest.json");
const manifest = existsSync(manifestPath)
  ? JSON.parse(readFileSync(manifestPath, "utf8"))
  : { sources: {} };
for (const source of SOURCES) {
  if (only.length && !only.includes(source.name)) continue;
  process.stdout.write(`${source.name} ... `);
  let files;
  try {
    if (source.repo) {
      const checkout = clone(source);
      files = markdownFiles(checkout, source.extensions ?? [".md"]);
    } else {
      const dir = freshFolder(source.name);
      const texts = source.examples
        ? specExamples(await download(source.url))
        : await Promise.all(
            source.files.map((url) => download(url).catch(() => null)),
          );
      files = [];
      texts.forEach((text, i) => {
        if (text === null) return;
        const path = join(dir, `${String(i + 1).padStart(4, "0")}.md`);
        writeFileSync(path, text);
        files.push(path);
      });
    }
  } catch (error) {
    console.log(`failed (${error.message})`);
    continue;
  }
  files = evenly(files, source.take);
  manifest.sources[source.name] = {
    origin: source.repo ?? source.url ?? "raw README.md files",
    licence: source.licence,
    files: files.map((path) => relative(cache, path)),
  };
  console.log(`${files.length} files`);
}
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
const total = Object.values(manifest.sources).reduce(
  (sum, source) => sum + source.files.length,
  0,
);
console.log(`${total} files in ${relative(root, manifestPath)}`);
