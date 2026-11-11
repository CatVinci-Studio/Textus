import { currentStrings } from "../../i18n/current";
import type { Dispatch, SetStateAction } from "react";
import {
  CloseIcon,
  GenericFileIcon,
  ImageFileIcon,
} from "../../engine/controls/icons";
import type { ChatAttachment } from "../types";

/** The files going with the message, above its text, each removable;
 *  those mentioned in the text show there instead. */
export function AttachmentChips({
  attachments,
  mentioned,
  setAttachments,
  truncatedLabel,
}: {
  attachments: ChatAttachment[];
  mentioned: readonly string[];
  setAttachments: Dispatch<SetStateAction<ChatAttachment[]>>;
  truncatedLabel: string;
}) {
  const shown = attachments
    .map((file, i) => ({ file, i }))
    .filter(
      ({ file }) =>
        !(file.kind === "text" && mentioned.includes(file.path ?? "")),
    );
  if (shown.length === 0) return null;
  return (
    <div className="inline-chat-attachments">
      {shown.map(({ file, i }) => (
        <span key={i} className="inline-chat-attachment">
          {/* Extracted text and a native image part reach the model
            differently, so the chip says which this is. */}
          {file.kind === "image" ? (
            <ImageFileIcon className="inline-chat-attachment-kind" />
          ) : (
            <GenericFileIcon className="inline-chat-attachment-kind" />
          )}
          <span className="inline-chat-attachment-name">{file.name}</span>
          {/* A file cut at the extraction cap says so, or a partial answer
            looks like the model misread the document. */}
          {file.kind === "text" && file.truncated && (
            <span className="inline-chat-attachment-note">
              {truncatedLabel}
            </span>
          )}
          <button
            className="inline-chat-attachment-remove"
            aria-label={`${currentStrings().agentQueueRemove}: ${file.name}`}
            onClick={() =>
              setAttachments((prev) => prev.filter((_, j) => j !== i))
            }
          >
            <CloseIcon />
          </button>
        </span>
      ))}
    </div>
  );
}
