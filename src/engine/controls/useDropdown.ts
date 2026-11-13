import { useId, useState, type KeyboardEvent } from "react";
import { useMergedRef, usePresence } from "../motion/usePresence";
import { isImeKeydown } from "../../utils/ime";
import { listMove } from "./list-keys";
import { useFloatingList } from "./useFloatingList";

interface DropdownOptions {
  count: number;
  /** The row chosen now, highlighted as the list opens; -1 for none. */
  selected: () => number;
  /** A row was chosen; the list has closed. */
  choose: (index: number) => void;
  /** Rows the keys step over and a choice ignores. */
  isDisabled?: (index: number) => boolean;
  /** How tall the list may grow; a longer one scrolls. */
  maxHeight?: number;
  /** As it opens, before the list takes the focus. */
  onOpen?: () => void;
  /** Where the focus goes as it closes; the trigger by default. */
  refocus?: () => void;
}

/**
 * A dropdown's state and keys: the trigger opens it on the arrows, Enter or
 * Space; the list steps with the arrows and Home and End, chooses with
 * Enter or Space, closes with Escape (only itself, not a dialog around it)
 * or Tab. It opens beside its trigger and shrinks back into it.
 */
export function useDropdown({
  count,
  selected,
  choose,
  isDisabled = () => false,
  maxHeight,
  onOpen,
  refocus,
}: DropdownOptions) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const floating = useFloatingList(
    open,
    active,
    () => setOpen(false),
    maxHeight,
  );
  const listId = useId();
  const presence = usePresence(open);
  const listRef = useMergedRef(floating.listRef, presence.ref);

  const openMenu = () => {
    if (count === 0) return;
    onOpen?.();
    setActive(Math.max(0, selected()));
    setOpen(true);
  };
  const close = (back = true) => {
    setOpen(false);
    if (!back) return;
    if (refocus) refocus();
    else floating.triggerRef.current?.focus();
  };
  const pick = (index: number) => {
    if (index < 0 || index >= count || isDisabled(index)) return;
    close();
    choose(index);
  };
  /** Where `key` moves from `at`, over disabled rows; null for no move. */
  const move = (key: string, at: number) => {
    let next = listMove(key, at, count);
    if (next === null) return null;
    const back = key === "ArrowUp" || key === "End" ? -1 : 1;
    for (let i = 0; i < count && isDisabled(next); i++)
      next = (next + back + count) % count;
    return next;
  };

  /** The list's keys; false for one it leaves to the caller (type-ahead). */
  const onListKey = (e: KeyboardEvent<HTMLElement>): boolean => {
    if (isImeKeydown(e)) return true;
    const moved = move(e.key, active);
    if (moved !== null) {
      e.preventDefault();
      setActive(moved);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      pick(active);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "Tab") close();
    else return false;
    return true;
  };
  const onTriggerKey = (e: KeyboardEvent<HTMLElement>) => {
    // Keys pressed before the open list has taken focus are its keys.
    if (open) return void onListKey(e);
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
      e.preventDefault();
      openMenu();
    }
  };

  return {
    open,
    active,
    setActive,
    triggerRef: floating.triggerRef,
    listRef,
    place: floating.place,
    presence,
    listId,
    openMenu,
    close,
    choose: pick,
    onListKey,
    onTriggerKey,
  };
}
