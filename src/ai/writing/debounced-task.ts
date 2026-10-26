/// Debounces an AI request behind typing, and lets the response be dropped
/// if a newer keystroke scheduled another while it was in flight.
export function createDebouncedTask(delayMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let seq = 0;

  function cancel() {
    if (timer) clearTimeout(timer);
  }

  /// `fn` gets `isCurrent()`, false once a later `schedule` call has
  /// superseded this one (check it after an `await`).
  function schedule(fn: (isCurrent: () => boolean) => void | Promise<void>) {
    cancel();
    const mySeq = ++seq;
    timer = setTimeout(() => {
      void fn(() => mySeq === seq);
    }, delayMs);
  }

  return { schedule, cancel };
}
