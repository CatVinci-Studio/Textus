/**
 * F6 and Shift+F6 move the focus between the window's regions on screen,
 * the way out of an editor where Tab indents. A region gets the focus back
 * where it last had it, else at its natural start.
 */

const REGIONS: { region: string; start?: string }[] = [
  { region: ".window-bar" },
  {
    region: ".sidebar:not(.sidebar-collapsed)",
    start: '[role="treeitem"][tabindex="0"], .sidebar-tab-active',
  },
  { region: ".tab-bar", start: '[role="tab"][tabindex="0"]' },
  {
    region:
      '[data-active-tab="true"] > :is(.editor-scroll, .source-view, .split-view)',
    start: ".ProseMirror, textarea",
  },
  { region: ".review-bar" },
  { region: ".agent-panel", start: "textarea" },
];

const TABBABLE =
  'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

const lastFocus = new WeakMap<Element, HTMLElement>();
// The document's caret as the focus left it: focusing the editor again
// would put it at the start.
const carets = new WeakMap<Element, Range>();

function shown(el: Element): boolean {
  return el.getClientRects().length > 0 && !el.closest("[inert]");
}

function regionsOnScreen(): Element[] {
  return REGIONS.map(({ region }) => document.querySelector(region)).filter(
    (el): el is Element => !!el && shown(el),
  );
}

/** Remembers where the focus was in each region, for coming back. */
export function trackRegionFocus(): () => void {
  const onFocusIn = (e: FocusEvent) => {
    const target = e.target as HTMLElement;
    for (const { region } of REGIONS) {
      const el = target.closest?.(region);
      if (el) lastFocus.set(el, target);
    }
  };
  const onFocusOut = (e: FocusEvent) => {
    const target = e.target as HTMLElement;
    const selection = window.getSelection();
    if (target.isContentEditable && selection?.rangeCount)
      carets.set(target, selection.getRangeAt(0).cloneRange());
  };
  document.addEventListener("focusin", onFocusIn);
  document.addEventListener("focusout", onFocusOut);
  return () => {
    document.removeEventListener("focusin", onFocusIn);
    document.removeEventListener("focusout", onFocusOut);
  };
}

function focusRegion(region: Element): boolean {
  const remembered = lastFocus.get(region);
  const { start } = REGIONS.find((r) => region.matches(r.region)) ?? {};
  const candidates = [
    remembered,
    start ? region.querySelector<HTMLElement>(start) : null,
    // A region that is one control (the source-mode text box).
    region.matches(TABBABLE) ? (region as HTMLElement) : null,
    ...region.querySelectorAll<HTMLElement>(TABBABLE),
  ];
  for (const el of candidates) {
    if (!el || !el.isConnected || !region.contains(el) || !shown(el)) continue;
    el.focus({ preventScroll: true });
    if (document.activeElement !== el) continue;
    const caret = carets.get(el);
    if (caret && el.contains(caret.startContainer)) {
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(caret);
    }
    return true;
  }
  return false;
}

/** Moves the focus to the next region (1) or the previous one (-1). */
export function cycleRegion(step: 1 | -1): void {
  const regions = regionsOnScreen();
  if (regions.length === 0) return;
  const active = document.activeElement;
  const at = regions.findIndex((el) => active && el.contains(active));
  for (let i = 1; i <= regions.length; i++) {
    const index =
      at === -1
        ? step === 1
          ? i - 1
          : regions.length - i
        : (at + step * i + regions.length * i) % regions.length;
    if (focusRegion(regions[index])) return;
  }
}
