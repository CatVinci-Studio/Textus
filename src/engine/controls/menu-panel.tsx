import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { Tooltip } from "./Tooltip";
import {
  Presence,
  useMergedRef,
  usePresenceProps,
  usePresenceState,
} from "../motion/usePresence";
import { useLatest } from "../../utils/hooks/useLatest";
import { useMenuAim } from "./menu-aim";
import { submenuPlace } from "./placement";
import { CheckIcon, ChevronIcon } from "./icons";
import { menuKeyStep } from "./list-keys";
import { useScrollFade } from "./scroll-fade";
import type {
  ContextMenuEntry,
  ContextMenuGroup,
  ContextMenuItem,
} from "./ContextMenu";

const MENU_ROWS = '[role^="menuitem"]:not(:disabled)';

/** Opened this soon after another closed, a submenu swaps in at once. */
const SWAP_MS = 400;

type Open = { index: number; focus: boolean } | null;

type Side = "left" | "right";

function isMenuGroup(entry: ContextMenuEntry): entry is ContextMenuGroup {
  return typeof entry === "object" && "items" in entry;
}

/** Where a menu is drawn: in the dialog its opener (its anchor, else what
 *  has the focus) is in, else in a modal one over the window, else on the
 *  page itself - never inside its opener, whose clip (a tab row's) would
 *  cut it. A floating plugin view is a dialog too, but not every menu's. */
export function menuHost(opener?: Element | null): Element {
  return (
    (opener ?? document.activeElement)?.closest('[role="dialog"]') ??
    [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].at(
      -1,
    ) ??
    document.body
  );
}

/** The group whose submenu is open, and whether it swaps in at once. */
function useOpenGroup() {
  const [open, setOpenNow] = useState<Open>(null);
  const [instant, setInstant] = useState(false);
  const closedAt = useRef(-Infinity);
  const setOpen = (next: Open) => {
    const now = performance.now();
    if (open) closedAt.current = now;
    setInstant(next !== null && now - closedAt.current < SWAP_MS);
    setOpenNow(next);
  };
  return { open, setOpen, instant };
}

/**
 * One level of a menu: its rows, arrow keys and menu aim, and the submenu
 * of the group open - beside its row, or with `inline` (a phone) under it.
 */
export function MenuPanel({
  items,
  onClose,
  inline = false,
  nested = false,
  panelRef,
  className,
  style,
  label,
  heading,
  surface,
  side = "right",
  onKeyDown,
  onMouseEnter,
}: {
  items: ContextMenuEntry[];
  onClose: () => void;
  inline?: boolean;
  /** Opened in place inside another level: its keys are that level's. */
  nested?: boolean;
  panelRef?: RefObject<HTMLDivElement | null>;
  className: string;
  style?: CSSProperties;
  label?: string;
  heading?: ReactNode;
  /** The surface's own props (a Presence's state and ref). */
  surface?: { ref?: (el: HTMLDivElement | null) => void } & Record<
    string,
    unknown
  >;
  /** The side its submenus try first: the one this level opened on. */
  side?: Side;
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void;
  onMouseEnter?: () => void;
}) {
  const own = useRef<HTMLDivElement>(null);
  const ref = panelRef ?? own;
  // Both: the panel's own, and the Presence's that times its exit.
  const setRef = useMergedRef(ref, surface?.ref);
  // A tall menu fades at the edge it goes on past; a phone's inline level
  // is part of its parent's scroll.
  useScrollFade(ref, "y", !nested);
  // Leaving, it takes its open submenu out with it.
  const leaving = usePresenceState() === "closing";
  const { open, setOpen, instant } = useOpenGroup();
  const subEl = useRef<HTMLDivElement | null>(null);
  const rows = useRef(new Map<number, HTMLButtonElement>());
  // A pointer on its way to the open submenu leaves it open (menu-aim.ts).
  const aim = useMenuAim<number>(
    (index) => {
      if (index !== (open?.index ?? null))
        setOpen(index === null ? null : { index, focus: false });
    },
    () => ref.current,
    () => subEl.current,
  );

  function keyDown(e: KeyboardEvent<HTMLDivElement>) {
    // Escape, Android's Back, folds a phone's open group before it closes
    // the menu; Escape or ← folds a submenu the pointer opened while the
    // keys are still here, before a second Escape closes the whole menu.
    if (open && (e.key === "Escape" || (!inline && e.key === "ArrowLeft"))) {
      e.preventDefault();
      e.stopPropagation();
      aim.hold();
      setOpen(null);
      return;
    }
    const next = menuKeyStep(e.key, ref.current, MENU_ROWS);
    if (next) {
      e.preventDefault();
      e.stopPropagation();
      next.focus();
    } else if (e.key === "Tab") {
      // A menu is left with Escape or a choice, not walked out of.
      e.preventDefault();
    } else onKeyDown?.(e);
  }

  // A level with an on/off or a choice keeps the check column on every
  // row, so the labels and shortcuts stay in line.
  const checks = items.some(
    (item) =>
      item !== "separator" &&
      !isMenuGroup(item) &&
      (item.checked !== undefined || item.current !== undefined),
  );
  const group = open && !inline && !leaving ? items[open.index] : undefined;
  const sub = group && isMenuGroup(group) && open ? { group, open } : null;
  return (
    <div
      {...surface}
      ref={setRef}
      role="menu"
      aria-label={label}
      data-floating-menu=""
      className={nested ? className : `${className} tx-scroll-veil`}
      style={style}
      onKeyDown={nested ? undefined : keyDown}
      onMouseMove={aim.move}
      onMouseEnter={onMouseEnter}
      onMouseLeave={aim.leave}
      // A press on an item doesn't take the focus: on Linux the button kept
      // it, and once the menu closed it fell to the page.
      onMouseDown={(e) => e.preventDefault()}
    >
      {heading}
      {items.map((item, i) =>
        item === "separator" ? (
          <div key={i} className="context-menu-separator" role="separator" />
        ) : isMenuGroup(item) ? (
          <Fragment key={i}>
            <button
              ref={(el) => {
                if (el) rows.current.set(i, el);
                else rows.current.delete(i);
              }}
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={open?.index === i}
              disabled={item.disabled}
              tabIndex={-1}
              className="context-menu-item context-menu-group"
              onMouseEnter={(e) => {
                if (!inline) aim.hover(i, e);
              }}
              onClick={() => {
                aim.hold();
                setOpen(
                  inline && open?.index === i
                    ? null
                    : { index: i, focus: !inline },
                );
              }}
              onKeyDown={(e) => {
                if (e.key !== "ArrowRight" || inline) return;
                e.preventDefault();
                e.stopPropagation();
                aim.hold();
                setOpen({ index: i, focus: true });
              }}
            >
              <span className="context-menu-label tx-truncate">
                {item.label}
              </span>
              <ChevronIcon className="context-menu-chevron" />
            </button>
            {inline && open?.index === i && (
              <MenuPanel
                items={item.items}
                onClose={onClose}
                inline
                nested
                className="context-menu-inline"
              />
            )}
          </Fragment>
        ) : (
          <MenuRow
            key={i}
            item={item}
            checks={checks}
            reveal={inline}
            onClose={onClose}
            onMouseEnter={(e) => aim.hover(null, e)}
          />
        ),
      )}
      <Presence show={!!sub}>
        {sub && (
          <SubMenu
            anchor={rows.current.get(sub.open.index) ?? null}
            items={sub.group.items}
            focus={sub.open.focus}
            instant={instant}
            prefer={side}
            subRef={subEl}
            onClose={onClose}
            onBack={() => {
              rows.current.get(sub.open.index)?.focus();
              aim.hold();
              setOpen(null);
            }}
            onLost={() => {
              // Its row scrolled out of sight: the keys go back to the menu.
              if (subEl.current?.contains(document.activeElement))
                rows.current
                  .get(sub.open.index)
                  ?.focus({ preventScroll: true });
              aim.hold();
              setOpen(null);
            }}
            onEnter={aim.hold}
          />
        )}
      </Presence>
    </div>
  );
}

function MenuRow({
  item,
  checks,
  reveal,
  onClose,
  onMouseEnter,
}: {
  item: ContextMenuItem;
  checks: boolean;
  /** A phone's: the checked row scrolled into view in a long list. */
  reveal: boolean;
  onClose: () => void;
  onMouseEnter: (e: { clientX: number; clientY: number }) => void;
}) {
  const label = (
    <span className="context-menu-label tx-truncate">{item.label}</span>
  );
  return (
    <button
      role={
        item.checked === undefined
          ? "menuitem"
          : item.toggle
            ? "menuitemcheckbox"
            : "menuitemradio"
      }
      aria-checked={item.checked}
      aria-current={item.current ? "location" : undefined}
      data-depth={item.depth}
      style={
        item.depth ? ({ "--depth": item.depth } as CSSProperties) : undefined
      }
      ref={
        reveal && item.checked && !item.toggle
          ? (el) => el?.scrollIntoView?.({ block: "nearest" })
          : undefined
      }
      tabIndex={-1}
      disabled={item.disabled}
      className={`context-menu-item${item.danger ? " context-menu-item-danger" : ""}`}
      onMouseEnter={onMouseEnter}
      onClick={(e) => {
        item.onSelect(e);
        onClose();
      }}
    >
      {item.hint ? (
        // Its whole text on hover, where WebKitGTK shows no title.
        <Tooltip text={item.hint} description={null}>
          {label}
        </Tooltip>
      ) : (
        label
      )}
      {item.accel && <span className="context-menu-accel">{item.accel}</span>}
      {checks && (
        <span className="context-menu-check" aria-hidden="true">
          {(item.checked || item.current) && <CheckIcon />}
        </span>
      )}
    </button>
  );
}

/** A group's items beside its row: on its menu's side, or across where the
 *  window ends; kept beside the row as the menu scrolls and the window
 *  changes size. Portalled, so the menu's own transform doesn't move it. */
function SubMenu({
  anchor,
  items,
  focus,
  instant,
  prefer,
  subRef,
  onClose,
  onBack,
  onLost,
  onEnter,
}: {
  anchor: HTMLElement | null;
  items: ContextMenuEntry[];
  focus: boolean;
  instant: boolean;
  prefer: Side;
  subRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
  onBack: () => void;
  /** Its row went out of sight. */
  onLost: () => void;
  onEnter: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const surface = usePresenceProps(ref);
  const leaving = usePresenceState() === "closing";
  const lost = useLatest(onLost);
  const [pos, setPos] = useState<{
    left: number;
    top: number;
    side: Side;
  } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    // On its way out it is no longer what the pointer aims for.
    if (leaving) {
      if (subRef.current === el) subRef.current = null;
      return;
    }
    subRef.current = el;
    if (!el || !anchor) return;
    const menu = anchor.closest('[role="menu"]') ?? anchor;
    const place = () => {
      const row = anchor.getBoundingClientRect();
      const box = menu.getBoundingClientRect();
      const middle = (row.top + row.bottom) / 2;
      if (middle < box.top || middle > box.bottom) return lost.current();
      const at = submenuPlace(row, box, el.getBoundingClientRect(), prefer);
      setPos({ ...at, side: at.left < box.left ? "left" : "right" });
    };
    place();
    menu.addEventListener("scroll", place);
    window.addEventListener("resize", place);
    return () => {
      menu.removeEventListener("scroll", place);
      window.removeEventListener("resize", place);
      if (subRef.current === el) subRef.current = null;
    };
  }, [anchor, items, prefer, subRef, leaving, lost]);
  // Once, as it is first placed: a scroll that moves it keeps the row the
  // keys are on.
  const placed = pos !== null;
  useEffect(() => {
    if (focus && placed)
      ref.current?.querySelector<HTMLElement>(MENU_ROWS)?.focus();
  }, [focus, placed]);

  return createPortal(
    <MenuPanel
      panelRef={ref}
      surface={{ ...surface, "data-side": pos?.side }}
      items={items}
      onClose={onClose}
      side={pos?.side}
      className={`context-menu context-submenu floating-surface${instant ? " context-submenu-instant" : ""}`}
      // Painted only once placed.
      style={
        pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }
      }
      onMouseEnter={onEnter}
      onKeyDown={(e) => {
        if (e.key !== "ArrowLeft" && e.key !== "Escape") return;
        e.preventDefault();
        e.stopPropagation();
        onBack();
      }}
    />,
    // By its row: the focus may be anywhere (WebKit doesn't focus a pressed
    // button), and a floating view's menu must stay in that view.
    menuHost(anchor),
  );
}
