import type { MilkdownPlugin } from "@milkdown/kit/ctx";
import type { Settings } from "../prefs/SettingsContext";
import { isMobileApp } from "../platform/capabilities";
import { createBlockHandlesPlugin } from "./blocks/block-handles-plugin";
import { dragAutoscrollPlugin } from "./keys/drag-autoscroll-plugin";
import { marginClickPlugin } from "./keys/margin-click-plugin";
import { pointerHoldPlugin } from "./pointer-hold";
import { createDrawnCaretPlugin } from "./drawn-caret-plugin";
import { textDragPlugin } from "./text-drag-plugin";

/** What the mouse and finger do in a document being written, in order. */
export function pointerPlugins(settings: {
  readonly current: Settings;
}): MilkdownPlugin[] {
  return [
    // Before the margin's clicks: held before they move the selection.
    pointerHoldPlugin,
    dragAutoscrollPlugin,
    textDragPlugin,
    marginClickPlugin,
    createBlockHandlesPlugin(),
    // Desktop only: a phone's or tablet's own caret has its handles.
    createDrawnCaretPlugin({
      enabled: () => !isMobileApp,
      glide: () => settings.current.smoothCaret,
    }),
  ].flat();
}
