import {
  showConfirm,
  showMessage,
  showPrompt,
} from "../../engine/controls/app-dialog";
import {
  endProgress,
  reportProgress,
  showNotice,
  startProgress,
} from "../../engine/controls/notices";
import {
  showPluginForm,
  type PluginFormField,
} from "../views/plugin-form-queue";
import {
  showQuickPick,
  type QuickPickItem,
} from "../../engine/controls/quick-pick-queue";
import { removeStatusItem, setStatusItem } from "../contributions/status-items";
import {
  optionalStr,
  str,
  type Params,
  type PluginScope,
} from "./broker-scope";
import { held } from "../contributions/key-holder";

function tone(value: unknown): "info" | "warning" | "error" {
  return value === "warning" || value === "error" ? value : "info";
}

/**
 * A plugin's commands and the dialogs it asks for, drawn as Textus draws its
 * own and titled with the plugin's name so the user knows who is asking. No
 * permission needed.
 */
/** The plugin a command id belongs to ("pub.name.cmd" -> "pub.name");
 *  null for Textus's own. */
function commandOwner(command: string): string | null {
  const owner = /^([a-z0-9-]+\.[a-z0-9-]+)\.[^.]/.exec(command)?.[1];
  return owner && !owner.startsWith("textus.") ? owner : null;
}

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
    "commands.execute": ({ command, args }: Params) => {
      const id = str(command, "command");
      const list = Array.isArray(args) ? args : [];
      // Here rather than an app command, so the dialog can say who asks.
      if (id === "textus.offerPlugin")
        return p.deps.offerPlugin({ id: p.id, name: p.name() }, list[0]);
      // Another plugin's command runs with that plugin's permissions: only
      // with leave to (`commands:<its id>`), and only one it lists.
      const owner = commandOwner(id);
      if (owner && owner !== p.id) p.need(`commands:${owner}`);
      return p.deps.runCommand(id, list, p.id);
    },
    // With an action ("Undo"), true when it was clicked before the note
    // went, false when it went by itself.
    "ui.notice": ({ text, tone: kind, action }: Params) =>
      new Promise<boolean>((resolve) =>
        showNotice(str(text, "text"), {
          tone: tone(kind),
          source: p.name(),
          action: optionalStr(action)
            ? { label: optionalStr(action)!, run: () => resolve(true) }
            : undefined,
          onGone: () => resolve(false),
        }),
      ),
    "ui.message": ({ text, tone: kind }: Params) =>
      showMessage(str(text, "text"), { title: p.name(), tone: tone(kind) }),
    "ui.confirm": ({ text, okLabel, danger }: Params) =>
      showConfirm(str(text, "text"), {
        title: p.name(),
        okLabel: optionalStr(okLabel) ?? p.t().pluginOk,
        cancelLabel: p.t().cancel,
        danger: danger === true,
      }),
    "ui.input": ({ prompt, value, placeholder }: Params) =>
      showPrompt(optionalStr(prompt) ?? "", optionalStr(value) ?? "", {
        title: p.name(),
        okLabel: p.t().pluginOk,
        cancelLabel: p.t().cancel,
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
      // A command line: the items among the palette's (Vim's ":"). Its
      // Enter is a key the user pressed, which the editor ops that follow
      // (":12", ":u") may act on.
      if (commands === true) {
        const picked = await p.deps.pickWithCommands(
          list,
          optionalStr(value) ?? "",
          optionalStr(placeholder),
        );
        if (held.owner?.plugin === p.id) held.owner.lastKeyAt = Date.now();
        return picked;
      }
      return showQuickPick(list, optionalStr(placeholder) ?? "", {
        multiple: multiple === true,
        query: optionalStr(value),
      });
    },
    "ui.form": ({ title, okLabel, fields }: Params) =>
      showPluginForm({
        from: p.name(),
        title: optionalStr(title) ?? p.name(),
        okLabel: optionalStr(okLabel) ?? p.t().pluginOk,
        cancelLabel: p.t().cancel,
        fields: (Array.isArray(fields) ? fields : []) as PluginFormField[],
      }),
    // One field of the form's, its value or null.
    "ui.pickDate": ({ title, value }: Params) =>
      pickOne(p, "date", title, value),
    "ui.pickColor": ({ title, value }: Params) =>
      pickOne(p, "color", title, value),
    "ui.progressStart": ({ title }: Params) => {
      const id = startProgress(str(title, "title"), {
        source: p.name(),
        cancelLabel: p.t().cancel,
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

function pickOne(
  p: PluginScope,
  type: "date" | "color",
  title: unknown,
  value: unknown,
): Promise<string | null> {
  return showPluginForm({
    from: p.name(),
    title: optionalStr(title) ?? p.name(),
    okLabel: p.t().pluginOk,
    cancelLabel: p.t().cancel,
    fields: [{ key: "value", type, label: "", value: optionalStr(value) }],
  }).then((values) => (values ? String(values.value) : null));
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
