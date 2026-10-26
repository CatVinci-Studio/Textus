import type {
  CompletionContribution,
  Contributes,
  MenuId,
  SettingContribution,
  ViewType,
} from "./manifest";

/** Where a plugin's menu items may go (contributes.menus). */
export const MENU_IDS: readonly MenuId[] = [
  "editor/context",
  "file/context",
  "tab/context",
  "view/title",
  "app/plugins",
  "app/tray",
];

/**
 * Reading a manifest's parts (manifest.ts's parseManifest): its
 * contributions above all, each checked and named in the error when it
 * is wrong, for the plugin's author.
 */

/** Why a manifest was refused, in English: it is shown as is in Settings
 *  under the plugin's name, for its author. */
export class ManifestError extends Error {}

/** A contributed id: the plugin's own namespace, then a name. */
const LOCAL_ID = /^[a-z0-9][a-z0-9.-]*$/i;

export type Json = Record<string, unknown>;

export function object(value: unknown, what: string): Json {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ManifestError(`${what} must be an object.`);
  return value as Json;
}

export function list(value: unknown, what: string): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new ManifestError(`${what} must be a list.`);
  return value;
}

export function text(value: unknown, what: string, optional = false): string {
  if (optional && value === undefined) return "";
  if (typeof value !== "string" || !value.trim())
    throw new ManifestError(`${what} must be a string.`);
  return value;
}

/** A contributed id must start with the plugin's id, so two plugins can't
 *  take each other's commands or views. */
function ownId(value: unknown, pluginId: string, what: string): string {
  const id = text(value, what);
  if (!id.startsWith(`${pluginId}.`) || !LOCAL_ID.test(id))
    throw new ManifestError(`${what} "${id}" must start with "${pluginId}.".`);
  return id;
}

function viewType(value: unknown, what: string): ViewType {
  if (value === undefined || value === "webview") return "webview";
  if (value === "list") return "list";
  throw new ManifestError(`${what} must be "list" or "webview".`);
}

/** Code block languages Textus draws itself: a plugin can't take them. */
const BUILT_IN_BLOCKS = ["mermaid", "math", "latex", "katex", "tex"];

/** `main`: one file, or several run in order (a plugin's shared code
 *  first) - the host takes no imports. */
export function parseMain(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  const files = typeof value === "string" ? [value] : list(value, "main");
  return files.map((f, i) => text(f, `main[${i}]`));
}

function parseSetting(raw: unknown, at: string): SettingContribution {
  const s = object(raw, at);
  const type = s.type;
  if (
    type !== "boolean" &&
    type !== "string" &&
    type !== "number" &&
    type !== "enum"
  )
    throw new ManifestError(
      `${at}.type must be boolean, string, number or enum.`,
    );
  const options =
    type === "enum"
      ? list(s.options, `${at}.options`).map((o, i) => {
          const opt = object(o, `${at}.options[${i}]`);
          return {
            value: text(opt.value, `${at}.options[${i}].value`),
            label: text(opt.label, `${at}.options[${i}].label`),
          };
        })
      : undefined;
  const fallback = s.default;
  const expected = type === "enum" ? "string" : type;
  if (typeof fallback !== expected)
    throw new ManifestError(`${at}.default must be a ${expected}.`);
  if (options && !options.some((o) => o.value === fallback))
    throw new ManifestError(`${at}.default must be one of its options.`);
  return {
    key: text(s.key, `${at}.key`),
    type,
    default: fallback as SettingContribution["default"],
    title: text(s.title, `${at}.title`),
    description: text(s.description, `${at}.description`, true) || undefined,
    options,
    ...(type === "string" && s.multiline === true ? { multiline: true } : {}),
  };
}

export function parseContributes(raw: unknown, id: string): Contributes {
  const c = raw === undefined ? {} : object(raw, "contributes");
  const commands = list(c.commands, "contributes.commands").map((x, i) => {
    const o = object(x, `contributes.commands[${i}]`);
    return {
      command: ownId(o.command, id, `contributes.commands[${i}].command`),
      title: text(o.title, `contributes.commands[${i}].title`),
    };
  });
  const declared = new Set(commands.map((x) => x.command));
  const declaredCommand = (value: unknown, what: string) => {
    const command = text(value, what);
    if (!declared.has(command))
      throw new ManifestError(
        `${what} "${command}" is not in contributes.commands.`,
      );
    return command;
  };
  const keybindings = list(c.keybindings, "contributes.keybindings").map(
    (x, i) => {
      const o = object(x, `contributes.keybindings[${i}]`);
      return {
        command: declaredCommand(
          o.command,
          `contributes.keybindings[${i}].command`,
        ),
        key: text(o.key, `contributes.keybindings[${i}].key`).toLowerCase(),
      };
    },
  );
  const menus: Contributes["menus"] = {};
  const rawMenus =
    c.menus === undefined ? {} : object(c.menus, "contributes.menus");
  for (const [where, items] of Object.entries(rawMenus)) {
    if (!(MENU_IDS as readonly string[]).includes(where))
      throw new ManifestError(`contributes.menus: no menu "${where}".`);
    menus[where as MenuId] = list(items, `contributes.menus.${where}`).map(
      (x, i) => {
        const o = object(x, `contributes.menus.${where}[${i}]`);
        return {
          command: declaredCommand(
            o.command,
            `contributes.menus.${where}[${i}].command`,
          ),
          when:
            text(o.when, `contributes.menus.${where}[${i}].when`, true) ||
            undefined,
          icon:
            text(o.icon, `contributes.menus.${where}[${i}].icon`, true) ||
            undefined,
        };
      },
    );
  }
  const sidebarTabs = list(c.sidebarTabs, "contributes.sidebarTabs").map(
    (x, i) => {
      const o = object(x, `contributes.sidebarTabs[${i}]`);
      return {
        id: ownId(o.id, id, `contributes.sidebarTabs[${i}].id`),
        title: text(o.title, `contributes.sidebarTabs[${i}].title`),
        type: viewType(o.type, `contributes.sidebarTabs[${i}].type`),
        icon:
          text(o.icon, `contributes.sidebarTabs[${i}].icon`, true) || undefined,
      };
    },
  );
  const views = list(c.views, "contributes.views").map((x, i) => {
    const o = object(x, `contributes.views[${i}]`);
    return {
      id: ownId(o.id, id, `contributes.views[${i}].id`),
      title: text(o.title, `contributes.views[${i}].title`),
      type: viewType(o.type, `contributes.views[${i}].type`),
    };
  });
  const customEditors = list(c.customEditors, "contributes.customEditors").map(
    (x, i) => {
      const at = `contributes.customEditors[${i}]`;
      const o = object(x, at);
      const patterns = list(o.filenamePatterns, `${at}.filenamePatterns`).map(
        (p, j) => text(p, `${at}.filenamePatterns[${j}]`).toLowerCase(),
      );
      if (!patterns.length)
        throw new ManifestError(`${at}.filenamePatterns is empty.`);
      return {
        viewType: ownId(o.viewType, id, `${at}.viewType`),
        displayName: text(o.displayName, `${at}.displayName`),
        filenamePatterns: patterns,
        priority:
          o.priority === "option" ? ("option" as const) : ("default" as const),
      };
    },
  );
  const settings = list(c.settings, "contributes.settings").map((x, i) =>
    parseSetting(x, `contributes.settings[${i}]`),
  );
  const page =
    c.settingsPage === undefined
      ? null
      : object(c.settingsPage, "contributes.settingsPage");
  const themes = list(c.themes, "contributes.themes").map((x, i) => {
    const o = object(x, `contributes.themes[${i}]`);
    return {
      id: ownId(o.id, id, `contributes.themes[${i}].id`),
      label: text(o.label, `contributes.themes[${i}].label`),
      path: text(o.path, `contributes.themes[${i}].path`),
    };
  });
  const aiTools = list(c.aiTools, "contributes.aiTools").map((x, i) => {
    const o = object(x, `contributes.aiTools[${i}]`);
    const name = text(o.name, `contributes.aiTools[${i}].name`);
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(name))
      throw new ManifestError(
        `contributes.aiTools[${i}].name "${name}" must be letters, digits, _ or -.`,
      );
    return {
      name,
      description: text(o.description, `contributes.aiTools[${i}].description`),
      parameters:
        o.parameters === undefined
          ? { type: "object", properties: {} }
          : object(o.parameters, `contributes.aiTools[${i}].parameters`),
    };
  });
  const completions = list(c.completions, "contributes.completions").map(
    (x, i) => {
      const at = `contributes.completions[${i}]`;
      const o = object(x, at);
      const where =
        o.where === undefined ? "any" : text(o.where, `${at}.where`);
      if (where !== "math" && where !== "text" && where !== "any")
        throw new ManifestError(`${at}.where must be "math", "text" or "any".`);
      const pattern = text(o.pattern, `${at}.pattern`);
      try {
        new RegExp(pattern);
      } catch {
        throw new ManifestError(`${at}.pattern is not a regular expression.`);
      }
      return {
        id: ownId(o.id, id, `${at}.id`),
        where: where as CompletionContribution["where"],
        pattern,
      };
    },
  );
  const links = list(c.links, "contributes.links").map((x, i) => {
    const at = `contributes.links[${i}]`;
    const o = object(x, at);
    const pattern = text(o.pattern, `${at}.pattern`);
    try {
      new RegExp(pattern);
    } catch {
      throw new ManifestError(`${at}.pattern is not a regular expression.`);
    }
    return { pattern, command: declaredCommand(o.command, `${at}.command`) };
  });
  const codeBlocks = list(c.codeBlocks, "contributes.codeBlocks").map(
    (x, i) => {
      const at = `contributes.codeBlocks[${i}]`;
      const o = object(x, at);
      const language = text(o.language, `${at}.language`).toLowerCase();
      if (!/^[a-z][a-z0-9-]{0,31}$/.test(language))
        throw new ManifestError(
          `${at}.language "${language}" must be a lowercase word.`,
        );
      if (BUILT_IN_BLOCKS.includes(language))
        throw new ManifestError(
          `${at}.language "${language}" is drawn by Textus itself.`,
        );
      return {
        language,
        title: text(o.title, `${at}.title`, true) || undefined,
      };
    },
  );
  return {
    aiTools,
    completions,
    links,
    codeBlocks,
    commands,
    keybindings,
    menus,
    sidebarTabs,
    views,
    customEditors,
    settings,
    settingsPage: page && {
      title: text(page.title, "contributes.settingsPage.title"),
    },
    themes,
  };
}
