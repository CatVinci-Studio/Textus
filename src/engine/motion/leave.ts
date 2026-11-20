/**
 * Takes out an element whose stylesheet exit has just been started (a
 * leaving class put on, an open class taken off): once its animations and
 * transitions, its own and its children's, have run, or after `within` ms
 * if they never do (a hidden window), and at once where nothing moves.
 */
export function removeWhenGone(
  el: Element,
  within: number,
  remove: () => void = () => el.remove(),
): void {
  const running = el.getAnimations?.({ subtree: true }) ?? [];
  if (running.length === 0) {
    remove();
    return;
  }
  let gone = false;
  const leave = () => {
    if (gone) return;
    gone = true;
    remove();
  };
  setTimeout(leave, within + 50);
  void Promise.allSettled(running.map((a) => a.finished)).then(leave);
}
