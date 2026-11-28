import { useCallback, useRef, useState, type ReactNode } from "react";
import { ContextMenu, type ContextMenuEntry } from "./ContextMenu";
import { Presence } from "../motion/usePresence";
import { usePressOpen } from "./press-open";

/**
 * A button that opens a menu below it - the one way to: the context menu's
 * look, keys (arrows, Home/End, Escape), submenus and closing, a phone's
 * too. Spread `button` on the button and render `menu` beside it. The
 * mouse opens it on the press (press-open.ts); a finger and the keys on the
 * click.
 */
export function useMenuButton(
  items: () => ContextMenuEntry[],
  options: {
    /** Names the menu: a heading row. */
    title?: string;
    /** The button sits at the end of its bar: the menu lines up with its
     *  right edge. */
    alignEnd?: boolean;
    /** Opens beside the button, not below: a button in a column. */
    beside?: "left" | "right";
    /** After it closes, picked or not (the format bar's document takes the
     *  keys back, keeping a phone's keyboard up). */
    onClosed?: () => void;
  } = {},
): {
  button: {
    ref: (el: HTMLElement | null) => void;
    "aria-haspopup": "menu";
    "aria-expanded": boolean;
    onPointerDown: (e: React.PointerEvent) => void;
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
  const closed = useRef(options.onClosed);
  closed.current = options.onClosed;
  const close = useCallback(() => {
    setAt(null);
    closed.current?.();
  }, []);
  /** Opens below (or beside) `button`, or closes the open menu. */
  const toggle = (button: HTMLElement, keyboard: boolean) => {
    if (at) {
      setAt(null);
      return false;
    }
    const box = button.getBoundingClientRect();
    const { beside, alignEnd } = options;
    setAt({
      x:
        beside === "right"
          ? box.right + 4
          : beside === "left"
            ? box.left - 4
            : alignEnd
              ? box.right
              : box.left,
      y: beside ? box.top : box.bottom + 4,
      keyboard,
    });
    return true;
  };
  const press = usePressOpen(
    (trigger) => toggle(trigger, false),
    '[data-floating-menu] [role^="menuitem"]',
  );
  return {
    button: {
      ref: (el) => {
        anchor.current = el;
      },
      "aria-haspopup": "menu",
      "aria-expanded": at !== null,
      onPointerDown: press.onPointerDown,
      onClick: (e) => {
        if (press.ownClick(e)) return;
        // detail 0: Enter or Space, not a pointer.
        toggle(e.currentTarget as HTMLElement, e.detail === 0);
      },
    },
    menu: (
      <Presence show={at !== null}>
        {at && (
          <ContextMenu
            x={at.x}
            y={at.y}
            keyboard={at.keyboard}
            anchor={anchor.current}
            alignEnd={
              options.beside ? options.beside === "left" : options.alignEnd
            }
            heading={options.title}
            items={items()}
            onClose={close}
          />
        )}
      </Presence>
    ),
    close,
  };
}
