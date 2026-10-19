import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { CheckIcon } from "../../ui/icons";

/**
 * Where a card over the composer goes (the "+" menu, the "/" and "@"
 * pickers): above it when it fits - a conversation's foot - below it when
 * there is more room there (the empty Agent home, composer mid-window),
 * and how tall it may be. Null until measured, as it opens.
 */
export function usePopoverPlace(
  ref: RefObject<HTMLElement | null>,
): { down: boolean; max: number } | null {
  const [place, setPlace] = useState<{ down: boolean; max: number } | null>(
    null,
  );
  useLayoutEffect(() => {
    const card = ref.current;
    const bar = card?.parentElement;
    if (!card || !bar) return;
    const box = bar.getBoundingClientRect();
    // Room under the window bar and header, and over the window's foot.
    const above = box.top - 80;
    const below = window.innerHeight - box.bottom - 16;
    const wanted = Math.min(card.scrollHeight, 440);
    const down = above < wanted && below > above;
    setPlace({ down, max: Math.max(160, Math.min(440, down ? below : above)) });
  }, [ref]);
  return place;
}

/** One entry of the composer's "+" menu: an action, or a switch. */
export interface ComposerMenuItem {
  key: string;
  icon: ReactNode;
  label: string;
  /** Quieter, beside the label: what it does or what it is now. */
  hint?: string;
  /** The words on its chip beside "+" while a switch is on (the label
   *  otherwise). */
  chip?: string;
  /** A switch: ticked in the menu, and a chip beside "+" while on. */
  on?: boolean;
  /** One of a set (the request's mode): ticked when it is the one. */
  selected?: boolean;
  disabled?: boolean;
  /** Which part of the menu: things to add to the message, the request's
   *  mode, or tools. */
  section?: "add" | "mode" | "tools";
  select: () => void;
}

export interface ComposerMenuSection {
  title: string;
  items: ComposerMenuItem[];
}

/**
 * What "+" opens above the composer: files and project material to add,
 * then the tools that shape the request (web search, images, auto-writing,
 * skills). Picking closes it; a switch that is on also shows as a chip
 * beside "+", where one click turns it off again.
 */
export function ComposerMenu({
  label,
  sections,
  trigger,
  onClose,
}: {
  label: string;
  sections: ComposerMenuSection[];
  /** The "+" button: a press on it toggles the menu, not an outside press. */
  trigger: RefObject<HTMLElement | null>;
  /** `refocus`: give focus back to "+" (Escape), not to what was picked. */
  onClose: (refocus: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const place = usePopoverPlace(ref);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);
  const items = () => [
    ...(ref.current?.querySelectorAll<HTMLElement>(
      ".composer-menu-item:not(:disabled)",
    ) ?? []),
  ];
  // Once placed (it is hidden until then, and hidden things take no focus).
  const placed = place !== null;
  useEffect(() => {
    if (placed) items()[0]?.focus({ preventScroll: true });
  }, [placed]);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (ref.current?.contains(target) || trigger.current?.contains(target))
        return;
      close.current(false);
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [trigger]);
  const onKeyDown = (event: React.KeyboardEvent) => {
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLElement);
    const step =
      event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (step) {
      event.preventDefault();
      list[(at + step + list.length) % list.length]?.focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      list[event.key === "Home" ? 0 : list.length - 1]?.focus();
    } else if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      close.current(true);
    }
  };
  let index = 0;
  return (
    <div
      className={`composer-menu${place?.down ? " is-below" : ""}`}
      style={place ? { maxHeight: place.max } : { visibility: "hidden" }}
      role="menu"
      aria-label={label}
      ref={ref}
      onKeyDown={onKeyDown}
    >
      {sections
        .filter((section) => section.items.length > 0)
        .map((section) => (
          <div
            key={section.title}
            role="group"
            aria-label={section.title}
            className="composer-menu-group"
          >
            <div className="composer-menu-title" aria-hidden="true">
              {section.title}
            </div>
            {section.items.map((item) => (
              <button
                key={item.key}
                type="button"
                role={
                  item.selected !== undefined
                    ? "menuitemradio"
                    : item.on !== undefined
                      ? "menuitemcheckbox"
                      : "menuitem"
                }
                aria-checked={item.selected ?? item.on}
                disabled={item.disabled}
                className="composer-menu-item"
                style={{ "--i": index++ } as React.CSSProperties}
                onClick={() => {
                  close.current(false);
                  item.select();
                }}
              >
                <span className="composer-menu-icon" aria-hidden="true">
                  {item.icon}
                </span>
                <span className="composer-menu-label">{item.label}</span>
                {item.hint && (
                  <span className="composer-menu-hint">{item.hint}</span>
                )}
                {(item.on || item.selected) && (
                  <CheckIcon className="composer-menu-check" />
                )}
              </button>
            ))}
          </div>
        ))}
    </div>
  );
}
