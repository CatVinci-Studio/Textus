import { createElement } from "react";
import { registerCommand, runCommand } from "../../app/commands";
import { registerSidebarTab } from "../../app/sidebar-tabs";
import { registerEditorMenuItems } from "../../editor/editor-menu-items";
import { showMessage } from "../../ui/app-dialog";
import { isMacPlatform } from "../../platform/os";
import { getActiveDocument, getWindowAccess } from "../app-bridge";
import { registerContextItems, type ContextMenuPlace } from "./context-menus";
import { setHoverStarter } from "./hover-providers";
import { localize, type MenuContribution } from "../store/manifest";
import {
  PluginListPane,
  PluginTabIcon,
  PluginWebviewPanel,
} from "../views/plugin-views";
import {
  pluginRecord,
  windowInfo,
  type PluginRecord,
} from "../store/plugin-records";
import { evaluateWhen, type WhenContext } from "./when";
import { addCodeBlockLanguage } from "./code-blocks";

/**
 * What an on plugin adds to the window, registered from its manifest
 * alone - its code starts the first time one of them is used (lazy, as
 * the app's heavy parts load): commands and their keys, its items in the
 * right-click menus, its sidebar tabs. A plugin whose manifest asks
 * (`onStartupFinished`, `onHover`, `onEditor`) starts sooner.
 */

/** What this needs of the manager (manager.ts). */
export interface ContributionDeps {
  /** Runs one of the plugin's commands in its code, starting it first. */
  runPluginCommand(
    id: string,
    command: string,
    args: unknown[],
  ): Promise<unknown>;
  /** Starts the plugin's code now. */
  start(id: string): Promise<void>;
}

const contributions = new Map<string, (() => void)[]>();

/** A file name's extension, with its dot: ".pdf". */
const extname = (path: string) => /\.[^./\\]+$/.exec(path)?.[0] ?? "";

export function hasContributions(id: string): boolean {
  return contributions.has(id);
}

/** Adds an undo to what goes when the plugin is withdrawn. */
export function addContribution(id: string, undo: () => void): void {
  contributions.get(id)?.push(undo);
}

/** The keys a menu item's `when` reads, as the window is now. */
export function whenContext(extra: WhenContext = {}): WhenContext {
  const doc = getActiveDocument();
  const path = (extra.resourcePath as string | undefined) ?? doc?.path ?? null;
  return {
    documentOpen: !!doc,
    editorHasSelection: !!doc && doc.selection().text.length > 0,
    folderOpen: !!getWindowAccess()?.rootPath(),
    fileExtension: path ? extname(path).toLowerCase() : undefined,
    resourceFilename: path ? path.split(/[\\/]/).pop() : undefined,
    isMac: isMacPlatform(),
    ...extra,
  };
}

/** Registers what an on plugin adds. */
export function applyContributions(
  record: PluginRecord,
  deps: ContributionDeps,
) {
  const manifest = record.manifest;
  if (!manifest || contributions.has(record.id)) return;
  const id = record.id;
  const text = (value: string) =>
    localize(manifest, value, windowInfo().language());
  const undo: (() => void)[] = [];
  const { commands, keybindings, menus, sidebarTabs, codeBlocks } =
    manifest.contributes;
  const titleOf = (command: string) =>
    text(commands.find((c) => c.command === command)?.title ?? command);
  for (const command of commands)
    undo.push(
      registerCommand({
        id: command.command,
        title: () => text(command.title),
        shortcut: keybindings.find((k) => k.command === command.command)?.key,
        run: (...args) =>
          void deps.runPluginCommand(id, command.command, args).catch((err) =>
            showMessage(String((err as Error)?.message ?? err), {
              title: text(manifest.name),
              tone: "error",
            }),
          ),
      }),
    );
  const editorItems = menus["editor/context"] ?? [];
  if (editorItems.length)
    undo.push(
      registerEditorMenuItems(({ selectedText }) =>
        editorItems
          .filter((item) =>
            evaluateWhen(
              item.when,
              whenContext({ editorHasSelection: !!selectedText }),
            ),
          )
          .map((item) => ({
            label: titleOf(item.command),
            onSelect: () => runCommand(item.command),
          })),
      ),
    );
  const places: ContextMenuPlace[] = [
    "file/context",
    "tab/context",
    "view/title",
  ];
  for (const place of places) {
    const items: MenuContribution[] = menus[place] ?? [];
    if (!items.length) continue;
    undo.push(
      registerContextItems(place, (target) =>
        items
          .filter((item) =>
            evaluateWhen(
              item.when,
              whenContext({
                resourcePath: target.path ?? undefined,
                view: target.view,
              }),
            ),
          )
          .map((item) => ({
            label: titleOf(item.command),
            icon: item.icon,
            plugin: id,
            // A file's or a tab's command is given its path.
            onSelect: () =>
              runCommand(item.command, target.path ? [target.path] : []),
          })),
      ),
    );
  }
  for (const tab of sidebarTabs)
    undo.push(
      registerSidebarTab({
        id: tab.id,
        label: () => text(tab.title),
        Icon: () =>
          createElement(PluginTabIcon, {
            plugin: id,
            origin: record.origin,
            icon: tab.icon,
          }),
        Panel: () =>
          tab.type === "list"
            ? createElement(PluginListPane, {
                plugin: id,
                view: tab.id,
                className: "plugin-list-sidebar",
              })
            : createElement(PluginWebviewPanel, {
                plugin: id,
                view: tab.id,
                kind: "sidebar",
              }),
      }),
    );
  for (const block of codeBlocks)
    undo.push(addCodeBlockLanguage(block.language, id));
  contributions.set(id, undo);
  const events = manifest.activationEvents;
  if (events.includes("onStartupFinished") || events.includes("*"))
    void deps.start(id).catch(() => {});
  else {
    if (events.includes("onHover")) {
      hoverWaiting.add(id);
      syncHoverStarter(deps);
    }
    if (events.includes("onEditor")) waitForEditor(id, deps);
  }
}

/** Plugins that start when the pointer first rests on a link (`onHover`)
 *  and haven't yet. */
const hoverWaiting = new Set<string>();

function syncHoverStarter(deps: ContributionDeps) {
  setHoverStarter(
    hoverWaiting.size,
    hoverWaiting.size === 0
      ? null
      : async () => {
          const ids = [...hoverWaiting];
          hoverWaiting.clear();
          syncHoverStarter(deps);
          await Promise.all(
            ids.map((id) =>
              pluginRecord(id)?.status === "on"
                ? deps.start(id).catch(() => {})
                : undefined,
            ),
          );
        },
  );
}

/** A plugin that marks the text (`onEditor`) starts once a document is in
 *  front - when the window is idle, so it never holds up the first paint. */
function waitForEditor(id: string, deps: ContributionDeps) {
  let stopped = false;
  const tryStart = () => {
    if (stopped) return;
    if (getActiveDocument()) {
      void deps.start(id).catch(() => {});
      return;
    }
    setTimeout(tryStart, 1000);
  };
  const idle =
    (window as { requestIdleCallback?: (fn: () => void) => void })
      .requestIdleCallback ?? ((fn: () => void) => setTimeout(fn, 300));
  idle(tryStart);
  contributions.get(id)?.push(() => {
    stopped = true;
  });
}

/** Takes back what a plugin added. */
export function withdrawContributions(id: string, deps?: ContributionDeps) {
  if (hoverWaiting.delete(id) && deps) syncHoverStarter(deps);
  for (const undo of contributions.get(id) ?? []) undo();
  contributions.delete(id);
}

/** Every plugin that added something. */
export function contributingPlugins(): string[] {
  return [...contributions.keys()];
}
