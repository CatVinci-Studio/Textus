import { plugins as pluginsIpc } from "../platform/ipc";
import { reloadPlugin } from "./manager";
import { pluginsSnapshot } from "./plugin-records";

/** Loads a developer's plugin again whenever its folder changes, while the
 *  returned function isn't called: its folder is looked at every
 *  `everyMs`. */
export function watchDevPlugins(everyMs = 1500): () => void {
  const seen = new Map<string, number | null>();
  let busy = false;
  const tick = async () => {
    if (busy || document.hidden) return;
    busy = true;
    try {
      for (const record of pluginsSnapshot().records) {
        if (record.origin !== "dev" || record.status !== "on") continue;
        const stamp = await pluginsIpc.devStamp(record.id).catch(() => null);
        const before = seen.get(record.id);
        seen.set(record.id, stamp);
        if (before !== undefined && stamp !== before) {
          await reloadPlugin(record.id);
          return;
        }
      }
    } finally {
      busy = false;
    }
  };
  const timer = window.setInterval(() => void tick(), everyMs);
  return () => window.clearInterval(timer);
}
