import { lazyComponent } from "../../lazy/lazy-component";
import { lazyModule } from "../../lazy/lazy-module";

// Create - the AI making a theme, plugin or skill - loads once the window
// is idle, so opening it doesn't wait. Its own module, held by the startup
// code (the settings layer), so it holds nothing else.
export const CreateChat = lazyComponent(
  lazyModule("create-chat", () => import("./CreateChat"), { warm: true }),
  (m) => m.CreateChat,
);
