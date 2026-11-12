import { Channel } from "@tauri-apps/api/core";
import type {
  DraftRequest,
  Outline,
  Paper,
  PaperEvent,
  PaperProgress,
  PaperRequest,
} from "./bindings/ai-paper";
import { aiCommand } from "./ipc-call";

/** Writing a paper (src-tauri/src/ai/paper): research and an outline to
 *  approve, then the draft, its progress as events. Part of `ai`. */
export const aiPaper = {
  /** A paper researched and outlined (src-tauri/src/ai/paper), its progress
   *  through `onEvent`; it stops at the outline for the user to approve. */
  paperRun: (request: PaperRequest, onEvent: (event: PaperEvent) => void) => {
    const channel = new Channel<PaperEvent>();
    channel.onmessage = onEvent;
    return aiCommand("ai_paper_run", request, channel) as Promise<Paper>;
  },
  /** The outline as the user edited it, kept for drafting. */
  paperSaveOutline: (
    docPath: string | null,
    workspaceRoot: string | null,
    id: string,
    outline: Outline,
  ) => aiCommand("ai_paper_save_outline", docPath, workspaceRoot, id, outline),
  /** How far a kept paper came: its stage, outline and sections written. */
  paperStatus: (
    docPath: string | null,
    workspaceRoot: string | null,
    id: string,
  ) =>
    aiCommand(
      "ai_paper_status",
      docPath,
      workspaceRoot,
      id,
    ) as Promise<PaperProgress>,
  /** The approved paper drafted, reviewed and finished; it arrives whole
   *  as a `ready` event. */
  paperDraft: (request: DraftRequest, onEvent: (event: PaperEvent) => void) => {
    const channel = new Channel<PaperEvent>();
    channel.onmessage = onEvent;
    return aiCommand("ai_paper_draft", request, channel);
  },
  /** Which of a `drawFigures` event's blocks couldn't be drawn: for each,
   *  why, or null. */
  paperFiguresDrawn: (callId: string, errors: (string | null)[]) =>
    aiCommand("ai_paper_figures_drawn", callId, errors),
};
