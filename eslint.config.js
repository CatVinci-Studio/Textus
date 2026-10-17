import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

// The layers of src/, lowest first: a folder imports from its own layer and
// the ones below, never above (docs/dev/architecture.md). Type-only imports are
// allowed across layers - they leave nothing behind at runtime.
const above = (folders) => ({
  "@typescript-eslint/no-restricted-imports": [
    "error",
    {
      patterns: folders.map((folder) => ({
        // Relative paths only: "@tauri-apps/api/app" is a package.
        group: [".", "..", "../..", "../../.."].flatMap((up) => [
          `${up}/${folder}`,
          `${up}/${folder}/**`,
        ]),
        allowTypeImports: true,
        message: `${folder}/ is a higher layer; see docs/dev/architecture.md.`,
      })),
    },
  ],
});
const FEATURES = [
  "ai",
  "clipboard",
  "document",
  "editor",
  "export",
  "mobile",
  "onboarding",
  "settings",
  "sidebar",
  "theme",
];
const SHELL = ["app", "document-view"];

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "dist-playground/**",
      "node_modules/**",
      "src-tauri/target/**",
      // Local git worktrees (.claude/worktrees) are other checkouts.
      ".claude/**",
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
    files: ["src/{utils,platform,i18n,storage}/**/*.{ts,tsx}"],
    ignores: ["**/*.test.*"],
    rules: above([...SHELL, ...FEATURES, "ui"]),
  },
  {
    files: ["src/ui/**/*.{ts,tsx}"],
    ignores: ["**/*.test.*"],
    rules: above([...SHELL, ...FEATURES.filter((f) => f !== "settings")]),
  },
  {
    files: ["src/editor/**/*.{ts,tsx}"],
    ignores: ["**/*.test.*"],
    rules: above([
      ...SHELL,
      "ai",
      "document",
      "export",
      "mobile",
      "onboarding",
      "sidebar",
    ]),
  },
  {
    files: [
      "src/{ai,clipboard,document,export,mobile,onboarding,settings,sidebar,theme}/**/*.{ts,tsx}",
    ],
    ignores: ["**/*.test.*"],
    rules: above(SHELL),
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
