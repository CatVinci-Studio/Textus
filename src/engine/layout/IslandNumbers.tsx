import { useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Presence, PresenceDiv } from "../motion/usePresence";
import {
  islandAnchors,
  islandNumbersShown,
  subscribeIslandNumbers,
} from "./island-numbers";

/**
 * Each island's number at its middle while ⌘ is held (island-numbers.ts):
 * over the window, there only while the hold lasts, taking no click.
 */
export function IslandNumbers() {
  const shown = useSyncExternalStore(
    subscribeIslandNumbers,
    islandNumbersShown,
  );
  return (
    <Presence show={shown} exitMs={120}>
      {shown && <Numbers />}
    </Presence>
  );
}

function Numbers() {
  // Where the islands were as the numbers came up: they leave from there.
  const [anchors] = useState(islandAnchors);
  return createPortal(
    <PresenceDiv className="island-numbers" aria-hidden="true">
      {anchors.map(({ paneId, rect }, i) => (
        <span
          key={paneId}
          className="island-number"
          style={{
            left: rect.left + rect.width / 2,
            top: rect.top + rect.height / 2,
          }}
        >
          {i + 1}
        </span>
      ))}
    </PresenceDiv>,
    document.body,
  );
}
