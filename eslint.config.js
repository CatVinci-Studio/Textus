import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

// The layers of src/, lowest first: a folder imports from its own layer and
// the ones below, never above (docs/dev/architecture.md). Type-only imports are
// allowed across layers - they leave nothing behind at runtime.
// Only src/platform/ (and the dev shim) talk to Tauri: everything else goes
// through it, so the same code can run in the browser build.
const TAURI = {
  group: ["@tauri-apps/*"],
  allowTypeImports: true,
  message: "Tauri is reached through src/platform/ only.",
};
const above = (folders, { tauri = false } = {}) => ({
  "@typescript-eslint/no-restricted-imports": [
    "error",
    {
      patterns: [
        ...folders.map((folder) => ({
          // Relative paths only: "@tauri-apps/api/app" is a package.
          group: [".", "..", "../..", "../../.."].flatMap((up) => [
            `${up}/${folder}`,
            `${up}/${folder}/**`,
          ]),
          allowTypeImports: true,
          message: `${folder}/ is a higher layer; see docs/dev/architecture.md.`,
        })),
        {
          // The sandbox and the broker are the plugins' own business:
          // the rest of the app goes through plugins/manager.ts and
          // plugins/app-bridge.ts (docs/dev/architecture.md).
          group: ["..", "../..", "../../.."].map(
            (up) => `${up}/plugins/host/**`,
          ),
          message:
            "plugins/host/ is inside the plugin system; use plugins/manager.ts or plugins/app-bridge.ts.",
        },
        ...(tauri ? [] : [TAURI]),
      ],
    },
  ],
});
const FEATURES = [
  "ai",
  "clipboard",
  "document",
  "editor",
  "export",
  "files",
  "mobile",
  "onboarding",
  "plugins",
  "settings",
  "theme",
  // What the shell and the features both register into or read: commands,
  // menus, shortcuts, sidebar tabs. Below the features, above the engine.
  "registry",
];
const SHELL = ["app", "document-view"];

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "dist-playground/**",
      "node_modules/**",
      "src-tauri/target/**",
      // The official plugins checked out for the plugin flows.
      "textus-plugins/**",
      // Local git worktrees (.claude/worktrees) are other checkouts.
      ".claude/**",
      // The save round-trip corpus: downloaded third-party files.
      ".cache/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // Milkdown command/plugin APIs intentionally expose payloads with
      // provider-defined shapes. Tighten these incrementally at the adapter
      // boundaries rather than blocking the initial lint baseline.
      "@typescript-eslint/no-explicit-any": "off",
      // These compiler-oriented rules reject intentional latest-value refs
      // and adapter patterns used by Milkdown. The conventional hooks rules
      // remain enabled, including dependency checking and rules-of-hooks.
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/immutability": "off",
      "react-hooks/static-components": "off",
      "react-hooks/exhaustive-deps": "error",
    },
  },
  {
    files: ["src/{utils,i18n,storage}/**/*.{ts,tsx}"],
    ignores: ["**/*.test.*"],
    rules: above([...SHELL, ...FEATURES, "engine"]),
  },
  {
    files: ["src/platform/**/*.{ts,tsx}"],
    ignores: ["**/*.test.*"],
    rules: above([...SHELL, ...FEATURES, "engine"], { tauri: true }),
  },
  {
    // The settings model: what every layer above reads.
    files: ["src/prefs/**/*.{ts,tsx}"],
    ignores: ["**/*.test.*"],
    rules: above([...SHELL, ...FEATURES, "engine"]),
  },
  {
    // The engine: tokens and the colour system, motion, drag, controls,
    // layout - what every surface is drawn and moved with. It knows no
    // document, AI or plugin (docs/dev/architecture.md); inside it, each
    // part uses only those before it.
    files: ["src/engine/**/*.{ts,tsx}"],
    ignores: ["**/*.test.*"],
    rules: above([...SHELL, ...FEATURES]),
  },
  {
    files: ["src/engine/tokens/**/*.{ts,tsx}"],
    ignores: ["**/*.test.*"],
    rules: above([
      ...SHELL,
      ...FEATURES,
      "motion",
      "frame",
      "drag",
      "controls",
      "layout",
    ]),
  },
  {
    files: ["src/engine/motion/**/*.{ts,tsx}"],
    ignores: ["**/*.test.*"],
    rules: above([
      ...SHELL,
      ...FEATURES,
      "frame",
      "drag",
      "controls",
      "layout",
    ]),
  },
  {
    // The solver and the clock: what the drags, the controls and the
    // islands are placed and moved by.
    files: ["src/engine/frame/**/*.{ts,tsx}"],
    ignores: ["**/*.test.*"],
    rules: above([...SHELL, ...FEATURES, "drag", "controls", "layout"]),
  },
  {
    files: ["src/engine/drag/**/*.{ts,tsx}"],
    ignores: ["**/*.test.*"],
    rules: above([...SHELL, ...FEATURES, "controls", "layout"]),
  },
  {
    // Controls never need the islands: a page with a button doesn't bring
    // the window's layout along.
    files: ["src/engine/controls/**/*.{ts,tsx}"],
    ignores: ["**/*.test.*"],
    rules: above([...SHELL, ...FEATURES, "layout"]),
  },
  {
    files: ["src/editor/**/*.{ts,tsx}"],
    ignores: ["**/*.test.*"],
    // Plugins add to the editor through editor/extension-points.ts.
    rules: above([
      ...SHELL,
      "ai",
      "document",
      "export",
      "files",
      "mobile",
      "onboarding",
      "plugins",
    ]),
  },
  {
    files: [
      "src/{ai,clipboard,document,export,files,mobile,onboarding,plugins,settings,theme}/**/*.{ts,tsx}",
    ],
    ignores: ["**/*.test.*"],
    rules: above(SHELL),
  },
  {
    files: ["src/registry/**/*.{ts,tsx}"],
    ignores: ["**/*.test.*"],
    rules: above([...SHELL, ...FEATURES.filter((f) => f !== "registry")]),
  },
  {
    // The window's shell is the top layer: it may import anything but the
    // plugin system's insides.
    files: ["src/{app,document-view,lazy,playground,help}/**/*.{ts,tsx}"],
    ignores: ["**/*.test.*"],
    rules: above([]),
  },
  {
    // One import path per name: only these facades pass on what other
    // modules export (they stand for their folder).
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      "**/*.test.*",
      "src/platform/ipc.ts",
      "src/platform/bindings/**",
      "src/prefs/SettingsContext.tsx",
      "src/editor/extension-points.ts",
      "src/i18n/strings.ts",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "ExportNamedDeclaration[source.value=/^\\./], ExportAllDeclaration[source.value=/^\\./]",
          message:
            "Import the name from the module that declares it; only the folder facades re-export.",
        },
      ],
    },
  },
  {
    // The entry files aren't layered, but they still reach Tauri only
    // through src/platform/.
    files: ["src/*.{ts,tsx}"],
    ignores: ["**/*.test.*"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        { patterns: [TAURI] },
      ],
    },
  },
  {
    files: ["src/dev/**/*.{ts,tsx}"],
    ignores: ["**/*.test.*"],
    rules: above([], { tauri: true }),
  },
  {
    // Plugin code: the runtimes put into a plugin's sandboxed frames
    // (src/plugins/host/frames.ts) and the official plugins, plain scripts that
    // run there - in a browser, with `textus` given to them.
    files: ["src/plugins/host/runtime/**/*.js", "public/plugins/**/*.js"],
    ignores: ["public/plugins/**/lib/**"],
    languageOptions: {
      sourceType: "script",
      globals: {
        ...globals.browser,
        textus: "readonly",
        acquireTextusApi: "readonly",
        exports: "writable",
        module: "writable",
      },
    },
  },
  {
    files: [
      "vite.config.ts",
      "vite.playground.config.ts",
      "eslint.config.js",
      "scripts/**/*.mjs",
    ],
    languageOptions: {
      globals: globals.node,
    },
  },
);
