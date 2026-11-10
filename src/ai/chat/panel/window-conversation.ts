import { lazyComponent } from "../../../lazy/lazy-component";
import { lazyModule } from "../../../lazy/lazy-module";

/** The window's conversations and the chat that draws them: loaded when
 *  the AI is first shown. */
export const windowConversation = lazyModule(
  "window-conversation",
  () => import("./WindowConversation"),
);

export const WindowConversation = lazyComponent(
  windowConversation,
  (m) => m.WindowConversation,
);
