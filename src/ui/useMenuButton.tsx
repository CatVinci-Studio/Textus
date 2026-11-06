import { useCallback, useRef, useState, type ReactNode } from "react";
import { ContextMenu, type ContextMenuEntry } from "./ContextMenu";
import { Presence } from "./usePresence";

/**
 * A button that opens a menu below it - the one way to: the context menu's
 * look, keys (arrows, Home/End, Escape), submenus and closing, and on a
 * phone an action sheet. Spread `button` on the button and render `menu`
 * beside it.
 */
export function useMenuButton(
  items: () => ContextMenuEntry[],
  options: {
    /** Names the menu: a heading row, and the phone sheet's title. */
    title?: string;
    /** The button sits at the end of its bar: the menu lines up with its
     *  right edge. */
    alignEnd?: boolean;
  } = {},
): {
  button: {
    ref: (el: HTMLElement | null) => void;
    "aria-haspopup": "menu";
    "aria-expanded": boolean;
    onClick: (e: React.MouseEvent) => void;
  };
  menu: ReactNode;
  close: () => void;
} {
  const [at, setAt] = useState<{
    x: number;
    y: number;
    keyboard: boolean;
  } | null>(null);
  const anchor = useRef<HTMLElement | null>(null);
  const close = useCallback(() => setAt(null), []);
  return {
    button: {
      ref: (el) => {
        anchor.current = el;
      },
      "aria-haspopup": "menu",
      "aria-expanded": at !== null,
      onClick: (e) => {
        if (at) return setAt(null);
        const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
        setAt({
          x: options.alignEnd ? box.right : box.left,
          y: box.bottom + 4,
          // detail 0: Enter or Space, not a pointer.
          keyboard: e.detail === 0,
        });
      },
    },
    menu: (
      <Presence show={at !== null} exitMs={120}>
        {at && (
          <ContextMenu
            x={at.x}
            y={at.y}
            keyboard={at.keyboard}
            anchor={anchor.current}
            alignEnd={options.alignEnd}
            heading={options.title}
            title={options.title}
            items={items()}
            onClose={close}
          />
        )}
      </Presence>
    ),
    close,
  };
}
