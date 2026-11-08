import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { currentStrings } from "../../i18n/current";
import {
  codeBlockPlugin,
  onCodeBlockLanguages,
} from "../../plugins/contributions/code-blocks";
import { pluginName, pluginRecord } from "../../plugins/store/plugin-records";
import { PluginCodeBlock } from "../../plugins/views/plugin-views";

/**
 * A plugin's blocks in an embedded note (a database, a chart): a line with
 * the plugin's name, drawn by the plugin once clicked - an embed of a page
 * with several stays short. Read-only: the note it is in owns its source.
 */
export function drawPluginBlocksIn(
  body: HTMLElement,
  path: string,
  signal: AbortSignal,
): void {
  let n = 0;
  const waiting: HTMLElement[] = [];
  const draw = (code: HTMLElement): boolean => {
    const language = /(?:^|\s)language-(\S+)/
      .exec(code.className)?.[1]
      ?.toLowerCase();
    const plugin = language ? codeBlockPlugin(language) : null;
    if (!language || !plugin) return false;
    const record = pluginRecord(plugin);
    const name = record ? pluginName(record) : plugin;
    const source = (code.textContent ?? "").replace(/\n$/, "");
    const widget = `embed:${path}:${language}:${++n}`;
    const card = document.createElement("span");
    card.className = "note-embed-block";
    const open = document.createElement("button");
    open.type = "button";
    open.className = "note-embed-block-open";
    open.textContent = currentStrings().embedBlockCard.replace("{0}", name);
    // The editor never sees the press: it would select the embed and show its source.
    open.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    open.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const holder = document.createElement("span");
      holder.className = "note-embed-block-page";
      open.replaceWith(holder);
      const root = createRoot(holder);
      root.render(
        createElement(PluginCodeBlock, {
          plugin,
          widget,
          seen: { language, source, meta: {}, path, block: widget },
          setSource: () => false,
        }),
      );
      signal.addEventListener("abort", () => root.unmount(), { once: true });
    });
    card.append(open);
    code.closest("pre")?.replaceWith(card);
    return true;
  };
  for (const code of body.querySelectorAll<HTMLElement>("pre > code"))
    if (!draw(code)) waiting.push(code);
  // A plugin that starts after the embed was drawn takes its blocks then.
  if (!waiting.length) return;
  const stop = onCodeBlockLanguages(() => {
    for (const code of waiting.splice(0))
      if (code.isConnected && !draw(code)) waiting.push(code);
    if (!waiting.length) stop();
  });
  signal.addEventListener("abort", stop, { once: true });
}
