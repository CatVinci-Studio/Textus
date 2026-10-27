/** What an AI request is refused with while Textus AI is off; keep in step
 *  with the Rust constant. */
export const AI_OFF = "textus-ai-off";

let allowed: () => boolean = () => true;

/** Tells AI requests whether Textus AI is on; the settings store hands over
 *  its live read before anything can ask. */
export function gateAiRequests(read: () => boolean): void {
  allowed = read;
}

export function aiRequestsAllowed(): boolean {
  return allowed();
}
