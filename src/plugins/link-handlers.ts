import { runCommand } from "../app/commands";
import { pluginsSnapshot } from "./plugin-records";

/**
 * Links plugins open (manifest `contributes.links`): a web link
 * Ctrl/Cmd+clicked in a document goes to the first plugin on whose pattern
 * matches its URL - Web View shows it in a tab - and to the system's
 * browser when none does (link-click-plugin.ts).
 */

interface Handler {
  pattern: RegExp;
  command: string;
}

let cachedFor: unknown = null;
let cached: Handler[] = [];

function handlers(): Handler[] {
  const snapshot = pluginsSnapshot();
  if (snapshot === cachedFor) return cached;
  cachedFor = snapshot;
  cached = snapshot.allOn
    ? snapshot.records.flatMap((r) =>
        r.status === "on" && r.manifest
          ? r.manifest.contributes.links.map((l) => ({
              pattern: new RegExp(l.pattern, "u"),
              command: l.command,
            }))
          : [],
      )
    : [];
  return cached;
}

/** Hands `url` to the plugin that opens such links; false when none
 *  does, and the browser should. */
export function openLinkInPlugin(url: string): boolean {
  const handler = handlers().find((h) => h.pattern.test(url));
  return !!handler && runCommand(handler.command, [url]);
}
