import { lazyModule } from "../lazy/lazy-module";

// Its Markdown renderer loads when a tab first shows it, not with the window:
// shown only when the user chose it, so kept out of the startup chunk. Warmed
// while idle; a window that opens on it loads it before its first frame.
export const startPageModule = lazyModule(
  "start-page",
  () => import("./StartPage"),
  { warm: true },
);
