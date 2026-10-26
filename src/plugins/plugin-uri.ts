import { commands, runCommand } from "../app/commands";
import { currentStrings } from "../i18n/current";
import { plugins as pluginsIpc } from "../platform/ipc";
import { showConfirm, showMessage } from "../ui/app-dialog";
import { askPlugin, loadPlugins } from "./manager";

/**
 * `textus://` links opened from outside: `textus://<plugin id>/<path>?<query>`
 * goes to that plugin; `textus://command/<id>?<query>` runs a command once the
 * user agrees, since a link is anyone's to write.
 */
export type TextusUri =
  | {
      kind: "plugin";
      plugin: string;
      /** From the slash after the plugin's id: "/item", or "/" for none. */
      path: string;
      query: Record<string, string>;
    }
  | {
      kind: "command";
      command: string;
      /** Given to the command as its one argument, when there is any. */
      query: Record<string, string>;
    };

const ID = /^[a-z0-9-]+\.[a-z0-9-]+$/;
const COMMAND_ID = /^[a-z0-9][a-z0-9.-]*$/i;

/** The link as Textus reads it; null when it isn't one. */
export function parseTextusUri(link: string): TextusUri | null {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  if (url.protocol !== "textus:") return null;
  const host = url.hostname.toLowerCase();
  const path = decodeURIComponent(url.pathname || "/") || "/";
  const query = Object.fromEntries(url.searchParams);
  if (host === "command") {
    const command = path.replace(/^\//, "");
    return COMMAND_ID.test(command)
      ? { kind: "command", command, query }
      : null;
  }
  return ID.test(host) ? { kind: "plugin", plugin: host, path, query } : null;
}

/** Runs a command a link names, if the user agrees; whether it ran. */
async function runLinkedCommand(
  command: string,
  query: Record<string, string>,
): Promise<boolean> {
  const t = currentStrings();
  const known = commands().find((c) => c.id === command);
  if (!known) return false;
  const ok = await showConfirm(
    t.uriCommandConfirm.replace("{command}", known.title(t)),
    { okLabel: t.uriCommandRun, cancelLabel: t.cancel },
  );
  // Declined is not "not taken": nothing to complain about.
  if (!ok) return true;
  return runCommand(command, Object.keys(query).length ? [query] : []);
}

/** Gives a link to the plugin it names, started first if it hasn't been;
 *  whether it took it. */
function givePlugin(uri: Extract<TextusUri, { kind: "plugin" }>) {
  return askPlugin(uri.plugin, "$uri", {
    path: uri.path,
    query: uri.query,
  }).then(
    (answer) => answer === true,
    () => false,
  );
}

/**
 * Takes the links waiting for this window and does what each says; one that
 * nothing takes is reported.
 */
export async function takePluginUris(): Promise<void> {
  // The plugins known first: a link can come before the window has them.
  await loadPlugins();
  const links = await pluginsIpc.takeUris().catch(() => [] as string[]);
  for (const link of links) {
    const uri = parseTextusUri(link);
    const taken = !uri
      ? false
      : uri.kind === "command"
        ? await runLinkedCommand(uri.command, uri.query)
        : await givePlugin(uri);
    if (!taken)
      void showMessage(
        currentStrings().pluginUriNotTaken.replace("{link}", link),
        { tone: "error" },
      );
  }
}
