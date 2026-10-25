import { Plugin } from "@milkdown/kit/prose/state";
import { $prose } from "@milkdown/kit/utils";
import { hasHoverProviders, provideHover } from "../../plugins/hover-providers";
import {
  floatingCardKey,
  hideHoverCard,
  keepHoverCard,
  scheduleHide,
  showHoverCard,
} from "./hover-card";
import { hoverSpot } from "./hover-target";

/** How long the pointer rests before a card is asked for. */
const REST_MS = 450;

/**
 * Quick looks at what a link points to: the pointer resting on a link, a
 * wikilink or a citation asks the plugins with a hover provider
 * (textus.editor.registerHoverProvider) for a card, shown beside it
 * (hover-card.ts). Nothing is asked while no plugin provides one.
 */
export function createLinkHoverPlugin(docPath: () => string | null) {
  return $prose(() => {
    let waiting: { key: string; timer: ReturnType<typeof setTimeout> } | null =
      null;
    const stopWaiting = () => {
      if (waiting) clearTimeout(waiting.timer);
      waiting = null;
    };
    return new Plugin({
      props: {
        handleDOMEvents: {
          mousemove(view, event) {
            if (!hasHoverProviders() || event.buttons !== 0) return false;
            const spot = hoverSpot(view, event, docPath());
            if (spot && spot.key === floatingCardKey()) {
              keepHoverCard();
              return false;
            }
            if (spot && spot.key === waiting?.key) return false;
            stopWaiting();
            if (floatingCardKey()) scheduleHide();
            if (!spot) return false;
            const key = spot.key;
            waiting = {
              key,
              timer: setTimeout(() => {
                void (async () => {
                  const target = await spot.resolve();
                  const card = target && (await provideHover(target));
                  if (waiting?.key !== key) return;
                  waiting = null;
                  if (card) showHoverCard(key, spot.rect, card);
                })();
              }, REST_MS),
            };
            return false;
          },
          mouseleave() {
            stopWaiting();
            scheduleHide();
            return false;
          },
          mousedown() {
            stopWaiting();
            hideHoverCard(true);
            return false;
          },
          keydown(_view, event) {
            stopWaiting();
            if (event.key === "Escape" && floatingCardKey()) hideHoverCard();
            return false;
          },
        },
      },
      view: () => {
        // The document scrolled under the card: it no longer sits by its
        // link. (Captured: scrolling doesn't bubble.)
        const scrolled = (event: Event) => {
          // The card's own text scrolling keeps it.
          if ((event.target as Element | null)?.closest?.(".hover-card"))
            return;
          stopWaiting();
          hideHoverCard(true);
        };
        window.addEventListener("scroll", scrolled, true);
        return {
          destroy() {
            window.removeEventListener("scroll", scrolled, true);
            stopWaiting();
            hideHoverCard(true);
          },
        };
      },
    });
  });
}
