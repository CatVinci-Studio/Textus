/** Mirrors ai::TEXTUS_AI_OFF in src-tauri/src/ai/mod.rs - what a request
 *  to an AI service is refused with while Textus AI is turned off. */
export const AI_OFF = "textus-ai-off";

let allowed: () => boolean = () => true;

/** Tells the requests to AI services (ipc.ts's aiCall) whether Textus AI
 *  is on: the settings store (settings/SettingsContext.tsx) hands over its
 *  live read as it loads, before anything can ask. */
export function gateAiRequests(read: () => boolean): void {
  allowed = read;
}

/** Whether a request to an AI service may go out right now. */
export function aiRequestsAllowed(): boolean {
  return allowed();
}
