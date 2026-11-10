/**
 * A rail icon carried out of its group toward the other (pinned ↔ the
 * plugins under the line): the scrolling group would clip the icon itself,
 * so a lifted copy follows the pointer, its place fades, and the group it
 * would join marks where it lands. Back inside its group, the row's own
 * reorder takes over again.
 */
export function liftBeyondGroup(
  down: PointerEvent,
  button: HTMLElement,
  group: HTMLElement,
  target: HTMLElement | null,
): void {
  let copy: HTMLElement | null = null;
  const box = button.getBoundingClientRect();
  const lift = () => {
    copy = button.cloneNode(true) as HTMLElement;
    copy.removeAttribute("data-reorder-id");
    copy.setAttribute("aria-hidden", "true");
    copy.classList.add("tx-drag-ghost", "is-lifted");
    Object.assign(copy.style, {
      left: "0",
      top: "0",
      width: `${box.width}px`,
      height: `${box.height}px`,
    });
    document.body.append(copy);
    button.classList.add("activity-rail-carried");
    target?.setAttribute("data-drop-here", "");
  };
  const settle = () => {
    copy?.remove();
    copy = null;
    button.classList.remove("activity-rail-carried");
    target?.removeAttribute("data-drop-here");
  };
  const move = (e: PointerEvent) => {
    const own = group.getBoundingClientRect();
    const out = e.clientY < own.top || e.clientY > own.bottom;
    if (out && !copy && Math.abs(e.clientY - down.clientY) >= 8) lift();
    else if (!out && copy) settle();
    if (copy)
      copy.style.translate = `${e.clientX - box.width / 2}px ${e.clientY - box.height / 2}px`;
  };
  const up = () => {
    settle();
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointercancel", up);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up, { once: true });
  window.addEventListener("pointercancel", up, { once: true });
}
