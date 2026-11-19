import {
  RESERVED_SCHEMES,
  setFarProvider,
  type FarFiles,
} from "../../platform/far-files";
import type { DirEntryInfo } from "../../platform/bindings/files";
import { OPEN_FOLDER_EVENT, sendAppEvent } from "../../utils/events";
import { basename, joinPath, parentDir } from "../../utils/path";
import { toBase64 } from "../store/files";
import { str, type Params, type PluginScope } from "./broker-scope";

/**
 * `textus.files.registerProvider`: paths of a plugin's own scheme
 * (`ssh://host/…`) read and written by the plugin, so a folder it serves
 * opens in the sidebar and its documents in tabs like any other.
 */

const SCHEME = /^[a-z][a-z0-9+.-]{1,30}$/;
/** How long one call may take: a remote folder answers slower than a disk. */
const WAIT_MS = 60_000;

/** Each scheme's plugin. */
const owners = new Map<string, string>();

type Ask = (op: string, args: unknown[]) => Promise<unknown>;

const entries = (url: string, listed: unknown): DirEntryInfo[] =>
  (Array.isArray(listed) ? listed : []).flatMap((e: unknown) => {
    const entry = e as { name?: unknown; folder?: unknown };
    const name = typeof entry?.name === "string" ? entry.name : "";
    // A server's name with a separator in it would name another path.
    if (!name || /[\\/]/.test(name) || name === "." || name === "..") return [];
    return [
      {
        name,
        path: joinPath(url, name),
        is_dir: entry.folder === true,
        hidden: name.startsWith("."),
        ignored: false,
      },
    ];
  });

function providerFiles(ask: Ask): FarFiles {
  return {
    listFolder: async (url) => entries(url, await ask("list", [url])),
    readText: async (url) => String(await ask("readText", [url])),
    readBase64: async (url) => {
      const bytes = await ask("read", [url]);
      if (!(bytes instanceof Uint8Array))
        throw new Error(`${basename(url)} wasn't read.`);
      return toBase64(bytes);
    },
    writeText: async (url, text) => {
      await ask("writeText", [url, text]);
    },
    createEntry: async (folder, name, isFolder) => {
      await ask("create", [folder, name, isFolder]);
      return joinPath(folder, name);
    },
    renameEntry: async (url, name) => {
      await ask("rename", [url, name]);
      return joinPath(parentDir(url) ?? url, name);
    },
    moveEntry: async (url, _from, into) => {
      await ask("move", [url, into]);
      return joinPath(into, basename(url));
    },
    deleteEntry: (url) => ask("delete", [url]),
  };
}

/** Takes a stopped plugin's schemes away. */
export function stopPluginProviders(plugin: string): void {
  for (const [scheme, owner] of owners)
    if (owner === plugin) {
      owners.delete(scheme);
      setFarProvider(scheme, null);
    }
}

export function providerHandlers(p: PluginScope) {
  const own = (scheme: unknown) => {
    const s = str(scheme, "scheme").toLowerCase();
    if (!SCHEME.test(s) || RESERVED_SCHEMES.includes(s))
      throw new Error(`${s} can't be a plugin's scheme.`);
    const owner = owners.get(s);
    if (owner && owner !== p.id) throw new Error(`${s} is ${owner}'s.`);
    return s;
  };
  return {
    "files.registerProvider": ({ scheme }: Params) => {
      const s = own(scheme);
      owners.set(s, p.id);
      setFarProvider(
        s,
        providerFiles((op, args) =>
          Promise.race([
            p.request("$provider", { scheme: s, op, args }),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error(`${s}: no answer.`)), WAIT_MS),
            ),
          ]),
        ),
      );
    },
    "files.unregisterProvider": ({ scheme }: Params) => {
      const s = own(scheme);
      owners.delete(s);
      setFarProvider(s, null);
    },
    /** Opens a folder the plugin provides as the window's folder. */
    "files.openFolder": ({ url }: Params) => {
      const at = str(url, "url");
      const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(at)?.[1]?.toLowerCase();
      if (!scheme || owners.get(scheme) !== p.id)
        throw new Error(`${at} isn't a folder this plugin provides.`);
      sendAppEvent(OPEN_FOLDER_EVENT, at);
    },
  };
}
