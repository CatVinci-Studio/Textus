import { useRef, type ReactNode } from "react";
import { useFitSteps } from "../../engine/controls/fit-steps";

/** The composer's steps short of room, measured: the model's name goes
 *  whole, then Send's word (its arrow stays), then the mode's name is cut. */
const TOOLBAR_STEPS = ["no-model", "send-icon", "short-mode"] as const;

/** The mode, the tools and Send, giving way in that order (useFitSteps). */
export function ComposerToolbar({ children }: { children: ReactNode }) {
  const row = useRef<HTMLDivElement>(null);
  useFitSteps(row, TOOLBAR_STEPS);
  return (
    <div ref={row} className="inline-chat-toolbar">
      {children}
    </div>
  );
}
