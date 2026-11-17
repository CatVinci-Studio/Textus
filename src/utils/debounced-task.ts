/// Runs work after a pause in typing; a later call supersedes an earlier one,
/// even one already running.
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
