#!/usr/bin/env node
// Checks the code shape rules: at most 500 lines per source file, at most 8
// hooks per component or custom hook, and no provider id compared outside
// its adapter.
// Files listed over a limit may shrink, not grow.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const MAX_LINES = 500;
const MAX_HOOKS = 8;

/** Over the line limit today: at most this many lines. */
const LINES_NOW = {};

/** Over the hook limit today: custom hooks that wire a window or an editor
 *  together, waiting to be split by concern. */
const HOOKS_NOW = {
  "src/ai/chat/window/useChatWindowBridge.ts useChatWindowBridge": 17,
  "src/ai/chat/window/useChatWindowHandoff.ts useChatWindowHandoff": 17,
  "src/ai/margin/useOwnRevisions.ts useOwnRevisions": 16,
  "src/ai/margin/useReviewNotes.ts useReviewNotes": 19,
  "src/ai/writing/useGrammarPopover.ts useGrammarPopover": 12,
  "src/app/frame/useSidePanels.ts useSidePanels": 16,
  "src/app/islands/useAiTabs.ts useAiTabs": 12,
  "src/app/tabs/useTabDragMerge.ts useTabDragMerge": 11,
  "src/app/useOpenFolder.ts useOpenFolder": 15,
  "src/app/usePluginWindow.ts usePluginWindow": 24,
  "src/app/useSaveTabs.ts useSaveTabs": 14,
  "src/app/useWindowDocuments.ts useWindowDocuments": 29,
  "src/app/useWindowShell.ts useWindowShell": 14,
  "src/app/useWindowWiring.ts useWindowWiring": 20,
  "src/document/autosave.ts useAutosave": 14,
  "src/document-view/useEditorChat.ts useEditorChat": 13,
  "src/document-view/useEditorProposals.ts useEditorProposals": 28,
  "src/document-view/useEditorSetup.ts useEditorSetup": 20,
  "src/document-view/useEditorWindowEvents.ts useEditorWindowEvents": 21,
  "src/document-view/usePaperWriter.ts usePaperWriter": 12,
  "src/editor/find/useFindReplace.ts useFindReplace": 32,
  "src/engine/controls/tabs/useTabStrip.ts useTabStrip": 16,
  "src/onboarding/useTutorial.ts useTutorial": 11,
  "src/playground/useWebDocuments.ts useWebDocuments": 12,
  "src/settings/useSettingsSearch.ts useSettingsSearch": 10,
};

/** Not held to the line limit: tables, not logic. */
const TABLES = [
  /^src\/i18n\/locales\//,
  /^src\/engine\/controls\/icons\.tsx$/,
  // Written by src-tauri/src/bindings.rs.
  /^src\/platform\/bindings\//,
];

function walk(dir, out = []) {
  for (const name of readdirSync(join(root, dir))) {
    const path = `${dir}/${name}`;
    if (name === "node_modules" || name === "target") continue;
    if (statSync(join(root, path)).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

const isTest = (path) =>
  /\.(test|spec)\.tsx?$/.test(path) ||
  /(^|\/)tests?(\.rs|\/)/.test(path) ||
  /_tests\.rs$/.test(path) ||
  // The live evals are test code (#[cfg(test)]).
  path.includes("/live_eval/") ||
  path.startsWith("src/dev/");

const sources = [
  ...walk("src").filter((p) => /\.tsx?$/.test(p)),
  // Plain scripts put into a plugin's frames as text.
  ...walk("src/plugins/host/runtime").filter((p) => p.endsWith(".js")),
  ...walk("src-tauri/src").filter((p) => p.endsWith(".rs")),
  ...walk("src-tauri/crates").filter((p) => p.endsWith(".rs")),
].filter((p) => !isTest(p));

const problems = [];

// Lines.
for (const path of sources) {
  if (TABLES.some((re) => re.test(path))) continue;
  const lines = readFileSync(join(root, path), "utf8").split("\n").length - 1;
  const cap = LINES_NOW[path] ?? MAX_LINES;
  if (lines > cap)
    problems.push(
      `${path}: ${lines} lines, over ${cap} - split it by concern (docs/dev/code-style.md, "Code shape")`,
    );
}

// Hooks per component, and per custom hook (`useX`, in .ts files too).
const COMPONENT =
  /^(?:export )?(?:default )?(?:function ([A-Z]\w*|use[A-Z]\w*)|const ([A-Z]\w*|use[A-Z]\w*) = (?:memo\()?(?:function \w*)?)/gm;
const NEXT_DECLARATION =
  /^(?:export )?(?:function|const|let|interface|type|class) [a-z_]/gm;
const HOOK = /(?<![\w.])use[A-Z]\w*\s*(?:<(?:[^<>]|<[^<>]*>)*>)?\s*\(/g;
for (const path of sources.filter((p) => /\.tsx?$/.test(p))) {
  const text = readFileSync(join(root, path), "utf8");
  const starts = [...text.matchAll(COMPONENT)].map((m) => ({
    at: m.index,
    name: m[1] ?? m[2],
  }));
  starts.forEach(({ at, name }, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].at : text.length;
    NEXT_DECLARATION.lastIndex = at + 1;
    const next = NEXT_DECLARATION.exec(text);
    const body = text.slice(at, next && next.index < end ? next.index : end);
    // A custom hook's own name isn't one of its calls.
    const hooks = (body.match(HOOK)?.length ?? 0) - (/^use/.test(name) ? 1 : 0);
    const cap = HOOKS_NOW[`${path} ${name}`] ?? MAX_HOOKS;
    if (hooks > cap)
      problems.push(
        `${path}: ${name} calls ${hooks} hooks, over ${cap} - move a concern into a hook of its own`,
      );
  });
}

// Provider ids compared in code. The ids are the catalog's; "custom" is
// the user's own endpoint, not a provider.
const catalog = readFileSync(join(root, "src-tauri/src/ai/catalog.rs"), "utf8");
const ids = [...catalog.matchAll(/^\s+id: "([a-z0-9-]+)"/gm)]
  .map((m) => m[1])
  .filter((id) => id !== "custom");
const alt = ids.map((id) => id.replace(/-/g, "\\-")).join("|");
const TS_COMPARE = new RegExp(
  `(?:===|!==)\\s*["'](?:${alt})["']|["'](?:${alt})["']\\s*(?:===|!==)|case\\s+["'](?:${alt})["']\\s*:`,
);
const RS_COMPARE = new RegExp(
  `(?:==|!=)\\s*"(?:${alt})"|"(?:${alt})"\\s*(?:=>|\\|)`,
);
// A provider's own adapter is where its differences are written down.
const ADAPTERS = [
  /^src-tauri\/crates\/aicompat\/src\/(providers|images)\//,
  /^src-tauri\/crates\/aicompat\/src\/capabilities/,
  /^src-tauri\/src\/ai\/catalog/,
];
for (const path of sources) {
  if (ADAPTERS.some((re) => re.test(path))) continue;
  const compare = path.endsWith(".rs") ? RS_COMPARE : TS_COMPARE;
  readFileSync(join(root, path), "utf8")
    .split("\n")
    .forEach((line, i) => {
      const code = line.trim();
      if (code.startsWith("//") || code.startsWith("*")) return;
      if (compare.test(code))
        problems.push(
          `${path}:${i + 1}: compares a provider id - make the difference data`,
        );
    });
}

if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(
  `code shape: ${sources.length} files within ${MAX_LINES} lines, components within ${MAX_HOOKS} hooks, no provider ids compared`,
);
