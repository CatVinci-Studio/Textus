import { createRoot, type Root } from "react-dom/client";
import { createElement } from "react";
import { ContextMenu, type ContextMenuEntry } from "./ContextMenu";
import { currentStrings } from "../i18n/current";
import { clipboardIpc } from "../platform/ipc";
import { editIpc } from "../platform/ipc-app";
import type { Strings } from "../i18n/strings";
import "./text-field-menu.css";

/**
 * Textus's own menu for a text field - undo, cut, copy, paste, select all -
 * where the system's would show (a field of a dialog, a panel, a plugin's
 * page): one look for every right-click in the app.
 */

/** What a text field's menu does: its value, as a page's menu returns it. */
export type TextFieldAction =
  "undo" | "redo" | "cut" | "copy" | "paste" | "selectAll";

/** The menu's items as a plugin page's menu takes them. */
export function textFieldItems(
  t: Strings,
  selected: boolean,
): (
  { label: string; value: TextFieldAction; disabled?: boolean } | "separator"
)[] {
  return [
    { label: t.menuUndo, value: "undo" },
    { label: t.menuRedo, value: "redo" },
    "separator",
    { label: t.cut, value: "cut", disabled: !selected },
    { label: t.copy, value: "copy", disabled: !selected },
    { label: t.paste, value: "paste" },
    "separator",
    { label: t.selectAll, value: "selectAll" },
  ];
}

/** The clipboard's text, through the app where the page can't read it. */
export async function clipboardText(): Promise<string> {
  return (
    (await clipboardIpc.text().catch(() => null)) ??
    (await navigator.clipboard.readText().catch(() => ""))
  );
}

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLElement;

const TEXT_INPUTS = /^(text|search|url|tel|email|password|number|)$/;

/** The text field a right-click landed in, if any. */
function fieldAt(target: EventTarget | null): Field | null {
  const el = target instanceof Element ? target : null;
  const field = el?.closest<HTMLElement>(
    "input, textarea, [contenteditable='true'], .cm-content",
  );
  if (!field) return null;
  if (field instanceof HTMLInputElement && !TEXT_INPUTS.test(field.type))
    return null;
  return field;
}

function selectionIn(field: Field): boolean {
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)
    return (field.selectionStart ?? 0) !== (field.selectionEnd ?? 0);
  return !(window.getSelection()?.isCollapsed ?? true);
}

/** `action` on `field`, its focus and selection as they were. */
async function run(field: Field, action: TextFieldAction): Promise<void> {
  field.focus();
  if (action === "paste") {
    if (await editIpc.natively("paste").catch(() => false)) return;
    const text = await clipboardText();
    if (text) document.execCommand("insertText", false, text);
    return;
  }
  if (action === "selectAll") {
    if (await editIpc.natively("select-all").catch(() => false)) return;
    if (
      field instanceof HTMLInputElement ||
      field instanceof HTMLTextAreaElement
    )
      field.select();
    else document.execCommand("selectAll");
    return;
  }
  if (action === "undo" || action === "redo") {
    if (await editIpc.natively(action).catch(() => false)) return;
  }
  document.execCommand(action);
}

let root: Root | null = null;

function show(x: number, y: number, field: Field): void {
  if (!root) {
    const host = document.createElement("div");
    host.className = "text-field-menu";
    document.body.append(host);
    root = createRoot(host);
  }
  const close = () => root?.render(null);
  const items: ContextMenuEntry[] = textFieldItems(
    currentStrings(),
    selectionIn(field),
  ).map((item) =>
    item === "separator"
      ? item
      : {
          label: item.label,
          disabled: item.disabled,
          onSelect: () => void run(field, item.value),
        },
  );
  root.render(createElement(ContextMenu, { x, y, items, onClose: close }));
}

/** Text fields take Textus's menu, not the system's. A menu someone else
 *  opened (the editor's) is left alone. */
export function installTextFieldMenu(): void {
  window.addEventListener("contextmenu", (event) => {
    if (event.defaultPrevented) return;
    const field = fieldAt(event.target);
    if (!field) return;
    event.preventDefault();
    show(event.clientX, event.clientY, field);
  });
}
