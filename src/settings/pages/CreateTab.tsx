import { Suspense } from "react";
import { CreateChat } from "./create-chat-lazy";
import type { Strings } from "../../i18n/strings";
import type { ExtensionsTab } from "./extensions-tab";

/**
 * Settings › Extensions › Create: say what you want, and Textus AI makes the
 * plugin, theme or skill in a conversation of its own, here in the store -
 * installed, tried and changed without leaving it, and without touching the
 * document behind.
 */
export function CreateTab({
  t,
  onOpenTab,
}: {
  t: Strings;
  onOpenTab: (tab: ExtensionsTab) => void;
}) {
  return (
    <Suspense fallback={null}>
      <CreateChat t={t} onOpenTab={onOpenTab} />
    </Suspense>
  );
}
