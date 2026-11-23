import { useEffect, useSyncExternalStore } from "react";
import {
  setFileIconTheme,
  type FileIconTheme,
} from "../../engine/controls/file-icon-theme";
import { dataUrl, readPluginFile } from "../store/files";
import type {
  FileIconThemeContribution,
  PluginManifest,
} from "../store/manifest-types";
import {
  pluginText,
  pluginsSnapshot,
  runningPlugins,
  subscribePlugins,
  type PluginRecord,
  type PluginsSnapshot,
} from "../store/plugin-records";
import { iconTheme, parseIconThemeJson } from "./file-icon-theme-json";

/**
 * Plugins' file icon themes: the ones to offer in Settings › Appearance,
 * and the chosen one read from its plugin and put in use. A choice is
 * `<plugin id>#<theme id>`; "" is the app's own icons. While its plugin is
 * off or not yet loaded the app's icons show, and the choice is kept.
 */

/** An icon bigger than this is a picture, not an icon: left out. */
const MOST_ICON_BYTES = 256 * 1024;

export interface FileIconThemeOption {
  id: string;
  label: string;
}

let offered: { from: PluginsSnapshot; options: FileIconThemeOption[] } | null =
  null;

function options(): FileIconThemeOption[] {
  const from = pluginsSnapshot();
  if (offered?.from !== from)
    offered = {
      from,
      options: runningPlugins(from).flatMap((r) =>
        r.manifest.contributes.fileIconThemes.map((theme) => ({
          id: `${r.id}#${theme.id}`,
          label: pluginText(r, theme.label),
        })),
      ),
    };
  return offered.options;
}

/** The themes the running plugins give, to choose from. */
export const useFileIconThemes = (): FileIconThemeOption[] =>
  useSyncExternalStore(subscribePlugins, options);

async function loadTheme(
  record: PluginRecord,
  theme: FileIconThemeContribution,
): Promise<FileIconTheme> {
  const read = (rel: string) => readPluginFile(record.id, record.origin, rel);
  const json: unknown = JSON.parse(
    new TextDecoder().decode(await read(theme.path)),
  );
  const parsed = parseIconThemeJson(json, theme.path);
  const urls = new Map<string, string>();
  await Promise.all(
    [...new Set(parsed.icons.values())].map(async (rel) => {
      const bytes = await read(rel).catch(() => null);
      if (bytes && bytes.length <= MOST_ICON_BYTES)
        urls.set(rel, dataUrl(rel, bytes));
    }),
  );
  return iconTheme(parsed, urls);
}

// What is in use now: read again only when the choice or the plugin's
// manifest (a new version, a folder reloaded) changes.
let shownChoice = "";
let shownManifest: PluginManifest | null = null;
let ticket = 0;

function follow(choice: string): void {
  const hash = choice.indexOf("#");
  const pluginId = choice.slice(0, hash);
  const record = runningPlugins(pluginsSnapshot()).find(
    (r) => hash > 0 && r.id === pluginId,
  );
  const theme = record?.manifest.contributes.fileIconThemes.find(
    (t) => t.id === choice.slice(hash + 1),
  );
  const manifest = theme ? record!.manifest : null;
  if (choice === shownChoice && manifest === shownManifest) return;
  shownChoice = choice;
  shownManifest = manifest;
  const mine = ++ticket;
  if (!record || !theme) {
    setFileIconTheme(null);
    return;
  }
  loadTheme(record, theme).then(
    (next) => {
      if (mine === ticket) setFileIconTheme(next);
    },
    (err: unknown) => {
      if (mine !== ticket) return;
      console.warn(`File icon theme ${choice}:`, err);
      setFileIconTheme(null);
    },
  );
}

/** Keeps the window's file icons on `choice` as plugins come and go. */
export function useFileIconThemeChoice(choice: string): void {
  useEffect(() => {
    follow(choice);
    return subscribePlugins(() => follow(choice));
  }, [choice]);
}
