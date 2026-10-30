import { lazyModule } from "../lazy/lazy-module";
import type * as Palette from "./command-palette";

// Out of the startup chunk, loaded once the window is idle: letters typed
// straight after the shortcut must reach its box.
const palette = lazyModule(
  "command-palette",
  () => import("./command-palette"),
  { warm: true },
);

export const openCommandPalette = (): Promise<void> =>
  palette.load().then((m) => m.openCommandPalette());

export const pickWithCommands = (
  ...args: Parameters<typeof Palette.pickWithCommands>
): Promise<unknown> => palette.load().then((m) => m.pickWithCommands(...args));
