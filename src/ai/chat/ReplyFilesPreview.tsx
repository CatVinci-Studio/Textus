import { useState } from "react";
import "./ReplyFilesPreview.css";

interface PreviewFile {
  /** Shown above its text when there is more than one file; null for none. */
  path: string | null;
  text: string;
}

/**
 * What an install card would install, folded under the card: the code is up
 * in the reply, but far from the button that runs it. Drawn only once opened,
 * so a long reply's cards cost nothing until asked.
 */
export function ReplyFilesPreview({
  label,
  files,
}: {
  label: string;
  files: readonly PreviewFile[];
}) {
  const [open, setOpen] = useState(false);
  if (files.length === 0) return null;
  const named = files.length > 1;
  return (
    <details
      className="disclosure agent-reply-files"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>{label}</summary>
      {open &&
        files.map((file, i) => (
          <div key={i} className="agent-reply-file">
            {named && file.path && (
              <div className="agent-reply-file-path">{file.path}</div>
            )}
            <pre>
              <code>{file.text.replace(/\n$/, "")}</code>
            </pre>
          </div>
        ))}
    </details>
  );
}
