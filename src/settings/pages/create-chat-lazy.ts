import { lazyComponent } from "../../lazy/lazy-component";
import { lazyModule } from "../../lazy/lazy-module";

// Create's chat is the editor's; it loads once the window is idle, so
// opening Create doesn't wait for it. Its own module: what holds this
// import is placed with the startup code, so it holds nothing else.
export const CreateChat = lazyComponent(
  lazyModule("create-chat", () => import("./CreateChat"), { warm: true }),
  (m) => m.CreateChat,
);
