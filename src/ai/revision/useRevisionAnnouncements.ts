import { useEffect, useRef } from "react";
import type { Strings } from "../../i18n/strings";
import type { Lang } from "../../i18n/langs";
import { plural } from "../../i18n/plural";
import { announce } from "../../ui/announce";

/**
 * Tells a screen reader what the review bar shows the eye: how many
 * changes Textus AI proposed once a rewrite is in, and which one the
 * review bar points at after ‹ / ›. Only the tab in front speaks. What a
 * decision did is reported by usePendingEdits (`onDecided`), wherever it
 * was made.
 */
export function useRevisionAnnouncements({
  active,
  stops,
  streaming,
  position,
  t,
  lang,
}: {
  active: boolean;
  stops: number;
  streaming: boolean;
  position: number;
  t: Strings;
  lang: Lang;
}) {
  const last = useRef({ stops, streaming, position });
  useEffect(() => {
    const before = last.current;
    last.current = { stops, streaming, position };
    if (!active) return;
    // Counted once a rewrite is all in, or when changes arrive whole.
    if (!streaming && stops > 0 && (before.streaming || stops > before.stops))
      announce(plural(t.announceChangesProposed, stops, lang));
    if (position >= 0 && position !== before.position)
      announce(
        t.announceChangePosition
          .replace("{i}", String(position + 1))
          .replace("{n}", String(stops)),
      );
  }, [active, stops, streaming, position, t, lang]);
}
