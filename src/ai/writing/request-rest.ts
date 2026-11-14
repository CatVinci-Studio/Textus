/** How long a writing aid rests after a request fails. */
const REST_MS = 30_000;

/**
 * Completions and the grammar check ask as the writer pauses; with no
 * provider signed in, or offline, each pause failed again and logged
 * again. After a failure one rests a while, the failure logged once.
 */
export function requestRest(name: string, ms = REST_MS) {
  let until = 0;
  return {
    resting: () => Date.now() < until,
    failed(err: unknown) {
      if (Date.now() >= until) console.error(`[${name}] request failed:`, err);
      until = Date.now() + ms;
    },
  };
}
