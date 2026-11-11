import { lazyComponent } from "../../lazy/lazy-component";
import { lazyModule } from "../../lazy/lazy-module";

// The menu the app draws is opened, not shown at launch: it loads once the
// window is idle, so the first click doesn't wait. Its own module: what
// holds this import is placed with the startup code, so it holds nothing
// else.
const appMenuModule = lazyModule("app-menu", () => import("./AppMenu"), {
  warm: true,
});

export const AppMenu = lazyComponent(appMenuModule, (m) => m.AppMenu);
