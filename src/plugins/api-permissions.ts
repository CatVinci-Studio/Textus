import type { Permission } from "./store/manifest";

/**
 * Which permission each plugin API call needs: one table, which the broker
 * checks as each call arrives (`guarded`) and the install check looks for
 * in a plugin's code (`PERMISSION_CALLS`). `methods` are what host.js sends
 * the broker, each written `textus.<method>` in a plugin; `calls` are the
 * other ways a plugin reaches the same thing, or what it also needs. A call that needs a
 * permission only sometimes - a project place, a job that notifies - checks
 * it in its handler.
 */
const API_PERMISSIONS: readonly {
  permission: Permission;
  methods: readonly string[];
  calls?: readonly string[];
}[] = [
  {
    permission: "editor.read",
    methods: [
      "editor.getPath",
      "editor.getText",
      "editor.getSelection",
      "editor.getCursor",
      "editor.getBlocks",
      "editor.getOutline",
      "editor.registerHover",
      "editor.registerDecorations",
      "editor.registerDiagnostics",
      "editor.registerOutline",
      "export.willExport",
      "ai.registerInlineCompletion",
      "ai.unregisterInlineCompletion",
    ],
    // Completions without it are left out, with no error to say so.
    calls: [
      "editor.registerCompletion",
      "export.onWillExport",
      "ai.registerInlineCompletion",
    ],
  },
  {
    permission: "editor.write",
    methods: [
      "editor.edit",
      "codeBlock.setSource",
      "editor.registerPasteHandler",
    ],
    // A code block's `block.setSource`.
    calls: ["editor.insertText", "editor.replaceSelection", "setSource"],
  },
  { permission: "editor.propose", methods: ["editor.propose"] },
  {
    permission: "editor.input",
    methods: ["editor.captureKeys", "editor.exec"],
    calls: ["keys.capture", "keys.exec"],
  },
  {
    permission: "files.read",
    methods: [
      "files.root",
      "files.conventions",
      "files.appSettings",
      "files.registerConventionReader",
      "files.unregisterConventionReader",
      "files.list",
      "files.find",
      "files.stat",
      "files.setBadge",
      "files.read",
      "files.frontmatterGet",
      "metadata.get",
      "metadata.all",
      "metadata.backlinks",
      "metadata.resolveLink",
      "metadata.resolveNote",
      "metadata.linkTo",
      "views.registerEmbed",
      "metadata.tags",
      "metadata.tasks",
      "metadata.search",
      "history.registerSource",
      "history.unregisterSource",
      "history.sources",
      "history.versions",
      "history.read",
      "git.status",
      "git.log",
      "git.show",
    ],
    // Writing goes through the folder's root, which reading grants.
    calls: [
      "files.readText",
      "metadata.",
      "history.",
      "files.writeText",
      "files.create",
      "files.process",
      "files.rename",
      "files.frontmatter.",
    ],
  },
  {
    permission: "files.write",
    methods: [
      "files.writeText",
      "files.write",
      "files.create",
      "files.processRead",
      "files.processWrite",
      "files.rename",
      "files.trash",
      "files.createFolder",
      "files.frontmatterSet",
      "files.setTask",
      "files.setConvention",
      "files.blockId",
      "files.willSave",
      "webview.writeFile",
    ],
    calls: [
      "files.process",
      "files.frontmatter.update",
      "files.onWillSave",
      "metadata.setTask",
    ],
  },
  { permission: "project.data", methods: [], calls: ["storage.project"] },
  {
    permission: "clipboard",
    methods: ["clipboard.readText", "clipboard.writeText"],
    calls: ["env.readClipboard", "env.writeClipboard"],
  },
  { permission: "notifications", methods: ["notify.show"] },
  {
    permission: "appearance",
    methods: ["appearance.setColors", "appearance.clear"],
  },
  { permission: "git.commit", methods: ["git.commit"] },
  {
    permission: "git.sync",
    methods: ["git.fetch", "git.push", "git.pull"],
  },
  // Checked when the window tells Rust the tools (contributions/ai-tools.ts).
  { permission: "ai.tools", methods: [], calls: ["ai.registerTool"] },
  {
    permission: "ai.model",
    methods: ["ai.available", "ai.complete", "ai.stream"],
  },
  {
    permission: "ssh",
    methods: [
      "ssh.hosts",
      "ssh.connect",
      "ssh.home",
      "ssh.list",
      "ssh.read",
      "ssh.write",
      "ssh.create",
      "ssh.rename",
      "ssh.delete",
      "ssh.close",
    ],
    calls: ["ssh.readText"],
  },
  {
    permission: "comments",
    methods: ["comments.list", "comments.add", "comments.resolve"],
    calls: ["comments.onDidChange"],
  },
];

const BY_METHOD = new Map<string, Permission[]>();
for (const { permission, methods } of API_PERMISSIONS)
  for (const method of methods)
    BY_METHOD.set(method, [...(BY_METHOD.get(method) ?? []), permission]);

/** The permissions broker method `method` always needs. */
function neededFor(method: string): readonly Permission[] {
  return BY_METHOD.get(method) ?? [];
}

/** `handlers`, each checking the permissions its method needs with `need`
 *  before it runs: the window's broker and background code both. */
export function guarded<H extends Record<string, unknown>>(
  handlers: H,
  need: (permission: Permission) => void,
): H {
  return Object.fromEntries(
    Object.entries(handlers).map(([name, run]) => {
      const permissions = neededFor(name);
      if (permissions.length === 0 || typeof run !== "function")
        return [name, run];
      return [
        name,
        (params: never) => {
          permissions.forEach(need);
          return (run as (params: never) => unknown)(params);
        },
      ];
    }),
  ) as H;
}

/** The table as a plugin's code names it, for tools outside the app
 *  (docs/dev/plugin-permissions.json, which a test keeps the same). */
export const PERMISSION_TABLE = API_PERMISSIONS.map(
  ({ permission, methods, calls = [] }) => ({
    permission,
    calls: [...methods, ...calls],
  }),
);

/** Every method the table names, for the test that holds it to the broker. */
export const PERMISSION_METHODS: readonly string[] = [...BY_METHOD.keys()];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** What a plugin's code writes for each permission's calls: `textus.<call>`,
 *  or `.<call>` on a context (`ctx.storage.project`). */
export const PERMISSION_CALLS: readonly [RegExp, Permission][] =
  API_PERMISSIONS.map(({ permission, methods, calls = [] }) => {
    const names = [...methods, ...calls].map(
      (name) => escape(name) + (name.endsWith(".") ? "" : "\\b"),
    );
    return [new RegExp(`\\.(?:${names.join("|")})`), permission];
  });
