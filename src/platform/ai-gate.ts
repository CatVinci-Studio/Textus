/** What an AI request is refused with while Textus AI is off. */
export { TEXTUS_AI_OFF as AI_OFF } from "./bindings/ai";

let allowed: () => boolean = () => true;

/** Tells AI requests whether Textus AI is on; the settings store hands over
 *  its live read before anything can ask. */
export function gateAiRequests(read: () => boolean): void {
  allowed = read;
}

export function aiRequestsAllowed(): boolean {
  return allowed();
}
