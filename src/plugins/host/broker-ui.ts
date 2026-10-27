import { showConfirm, showMessage, showPrompt } from "../../ui/app-dialog";
import {
  endProgress,
  reportProgress,
  showNotice,
  startProgress,
} from "../../ui/notices";
import { showPluginForm, type PluginFormField } from "../views/plugin-form";
import { showQuickPick, type QuickPickItem } from "../../ui/quick-pick";
import { removeStatusItem, setStatusItem } from "../contributions/status-items";
import {
  optionalStr,
  str,
  type Params,
  type PluginScope,
} from "./broker-scope";

function tone(value: unknown): "info" | "warning" | "error" {
  return value === "warning" || value === "error" ? value : "info";
}

/**
 * A plugin's commands and the dialogs it asks for, drawn as Textus draws its
 * own and titled with the plugin's name so the user knows who is asking. No
 * permission needed.
 */
export function uiHandlers(p: PluginScope) {
  const progresses = progressesOf(p.id);
  return {
    "commands.register": ({ command, editor }: Params) => {
      const id = str(command, "command");
      if (!id.startsWith(`${p.id}.`))
        throw new Error(`A command must start with "${p.id}.".`);
      p.deps.commandRegistered(p.id, id, editor === true);
    },
    "commands.unregister": ({ command }: Params) => {
      p.deps.commandUnregistered(p.id, str(command, "command"));
    },
    "commands.execute": ({ command, args }: Params) =>
      p.deps.runCommand(
        str(command, "command"),
        Array.isArray(args) ? args : [],
      ),
    "ui.notice": ({ text, tone: kind }: Params) => {
      showNotice(str(text, "text"), { tone: tone(kind), source: p.name() });
    },
    "ui.message": ({ text, tone: kind }: Params) =>
      showMessage(str(text, "text"), { title: p.name(), tone: tone(kind) }),
    "ui.confirm": ({ text, okLabel, danger }: Params) =>
      showConfirm(str(text, "text"), {
        title: p.name(),
        okLabel: optionalStr(okLabel) ?? p.t().pluginOk,
        cancelLabel: p.t().pluginCancel,
        danger: danger === true,
      }),
    "ui.input": ({ prompt, value, placeholder }: Params) =>
      showPrompt(optionalStr(prompt) ?? "", optionalStr(value) ?? "", {
        title: p.name(),
        okLabel: p.t().pluginOk,
        cancelLabel: p.t().pluginCancel,
        placeholder: optionalStr(placeholder),
      }),
    "ui.pick": async ({
      items,
      placeholder,
      multiple,
      value,
      commands,
    }: Params) => {
      const list = (Array.isArray(items) ? items : []).map((item) =>
        typeof item === "string"
          ? { label: item, value: item }
          : (item as QuickPickItem),
      );
      // A command line: the items among the palette's (Vim's ":").
      if (commands === true) {
        const { pickWithCommands } = await import("../../app/command-palette");
        return pickWithCommands(
          list,
          optionalStr(value) ?? "",
          optionalStr(placeholder),
        );
      }
      return showQuickPick(list, optionalStr(placeholder) ?? "", {
        multiple: multiple === true,
        query: optionalStr(value),
      });
    },
    "ui.form": ({ title, okLabel, fields }: Params) =>
      showPluginForm({
        title: optionalStr(title) ?? p.name(),
        okLabel: optionalStr(okLabel) ?? p.t().pluginOk,
        cancelLabel: p.t().pluginCancel,
        fields: (Array.isArray(fields) ? fields : []) as PluginFormField[],
      }),
    "ui.progressStart": ({ title }: Params) => {
      const id = startProgress(str(title, "title"), {
        source: p.name(),
        cancelLabel: p.t().pluginCancel,
        onCancel: () => p.request("$progressCancel", { id }).catch(() => {}),
      });
      progresses.add(id);
      return id;
    },
    "ui.progressReport": ({ id, fraction, message }: Params) => {
      if (typeof id === "number" && progresses.has(id))
        reportProgress(id, {
          fraction: typeof fraction === "number" ? fraction : undefined,
          message: optionalStr(message),
        });
    },
    "ui.progressEnd": ({ id }: Params) => {
      if (typeof id === "number" && progresses.delete(id)) endProgress(id);
    },
    "ui.setStatusItem": ({ id, text, tooltip, command }: Params) => {
      setStatusItem(p.id, str(id, "id"), {
        text: str(text, "text"),
        tooltip: optionalStr(tooltip),
        command: optionalStr(command),
      });
    },
    "ui.removeStatusItem": ({ id }: Params) => {
      removeStatusItem(p.id, str(id, "id"));
    },
  };
}

/** The progress bars each plugin has showing. */
const progressBars = new Map<string, Set<number>>();

function progressesOf(plugin: string): Set<number> {
  let set = progressBars.get(plugin);
  if (!set) progressBars.set(plugin, (set = new Set()));
  return set;
}

/** A plugin stopped: what it left showing goes. */
export function stopPluginUi(plugin: string): void {
  for (const id of progressBars.get(plugin) ?? []) endProgress(id);
  progressBars.delete(plugin);
  removeStatusItem(plugin);
}
