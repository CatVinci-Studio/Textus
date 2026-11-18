import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { Decoration } from "@milkdown/kit/prose/view";
import type { PluginDecoration } from "../../plugins/contributions/decorations";

/**
 * A plugin's mark in the margin right of a block, on its first line: a dot,
 * one or two characters, or the plugin's SVG, in the mark's tone. With a
 * command it is a button that runs it.
 */

/** Where the mark goes: inside a paragraph's or a heading's first line;
 *  before any other block (a list, a quote, code, a table), where it sits
 *  at the block's top and measures from the text's edge, not the block's
 *  own padding. */
export function firstLine(block: ProseNode, pos: number): number {
  return block.isTextblock && !block.type.spec.code ? pos + 1 : pos;
}

const svgMask = (svg: string) =>
  `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;

export function gutterMark(
  mark: PluginDecoration & { plugin: string },
  tone: string,
): HTMLElement {
  const command = mark.command;
  const el = document.createElement(command ? "button" : "span");
  el.className = `plugin-gutter plugin-tone-${tone}`;
  el.dataset.plugin = mark.plugin;
  el.dataset.editorChrome = "";
  el.contentEditable = "false";
  const icon = mark.icon?.trim() ?? "";
  if (icon.startsWith("<svg")) {
    el.dataset.icon = "svg";
    el.style.setProperty("--icon", svgMask(icon));
  } else if (icon && [...icon].length <= 2) el.textContent = icon;
  else el.dataset.icon = "dot";
  if (mark.tooltip) {
    el.setAttribute("aria-label", mark.tooltip);
    el.title = mark.tooltip;
  }
  if (command && el instanceof HTMLButtonElement) {
    el.type = "button";
    el.addEventListener("mousedown", (e) => e.preventDefault());
    el.addEventListener("click", (e) => {
      e.preventDefault();
      const args = Array.isArray(command.args) ? command.args : [];
      void import("../../plugins/manager")
        .then((m) => m.runPluginCommand(mark.plugin, command.id, args))
        .catch(() => {});
    });
  } else el.setAttribute("aria-hidden", "true");
  return el;
}

/** The mark beside the block at `pos`. */
export function drawGutter(
  block: ProseNode,
  pos: number,
  mark: PluginDecoration & { plugin: string },
  tone: string,
): Decoration {
  return Decoration.widget(
    firstLine(block, pos),
    () => gutterMark(mark, tone),
    {
      plugin: mark.plugin,
      side: -1,
      ignoreSelection: true,
      stopEvent: () => true,
      key: `gutter:${mark.plugin}:${mark.block}:${mark.icon ?? ""}:${tone}:${mark.tooltip ?? ""}:${mark.command?.id ?? ""}`,
    },
  );
}
