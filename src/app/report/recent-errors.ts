/** The last errors this window met, for a problem report. Kept in memory
 *  only, never written anywhere. */
const KEPT = 20;
const errors: string[] = [];

function keep(text: string) {
  const line = `${new Date().toISOString().slice(11, 19)} ${text}`;
  errors.push(line.length > 300 ? `${line.slice(0, 300)}…` : line);
  if (errors.length > KEPT) errors.shift();
}

export function watchErrors(): void {
  window.addEventListener("error", (event) =>
    keep(event.message || String(event.error)),
  );
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason as { message?: unknown } | undefined;
    keep(String(reason?.message ?? reason));
  });
}

export function recentErrors(): readonly string[] {
  return errors;
}
