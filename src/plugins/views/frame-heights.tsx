import { keepFresh } from "../../utils/keep-fresh";
// How tall each plugin block's page last said it was, by the block's widget
// key: the block made again (its tab reopened, scrolled back to) starts at
// that height instead of growing from nothing, then 120px, to it.

/** How many blocks' heights are kept. */
const HEIGHTS_KEPT = 500;

const heights = new Map<string, number>();

export function rememberFrameHeight(key: string, height: number): void {
  keepFresh(heights, key, height, HEIGHTS_KEPT);
}

/** The height `key`'s page last reported, if it has. */
export function frameHeight(key: string): number | undefined {
  return heights.get(key);
}

/** Sized as the frame it stands for (plugin-code-blocks.css). */
const FRAME_ROOM_CLASS = "plugin-frame-room";

/** The frame's room while it is made: what its page last reported, else
 *  the stylesheet's first height. */
export function framePlaceholder(key: string): HTMLElement {
  const room = document.createElement("div");
  room.className = FRAME_ROOM_CLASS;
  const height = frameHeight(key);
  if (height !== undefined) room.style.height = `${height}px`;
  return room;
}

/** `framePlaceholder`, drawn by React (while the block's page is loaded). */
export function FramePlaceholder({ heightKey }: { heightKey: string }) {
  const height = frameHeight(heightKey);
  return (
    <div
      className={FRAME_ROOM_CLASS}
      style={height === undefined ? undefined : { height }}
    />
  );
}
