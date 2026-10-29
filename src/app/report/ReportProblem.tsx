import { useEffect, useState } from "react";
import type { Strings } from "../../i18n/strings";
import { links, systemIpc } from "../../platform/ipc";
import { usePresence } from "../../ui/usePresence";
import { useModalDialog } from "../../ui/useModalDialog";
import type { Settings } from "../../prefs/settings-types";
import { reportDetails, reportUrl, type ReportFacts } from "./report";
import "./ReportProblem.css";

const listeners = new Set<(open: boolean) => void>();

/** Help > Report a Problem. */
export function openReportProblem(): void {
  for (const listener of listeners) listener(true);
}

/**
 * What went wrong, in the user's words, with what Textus fills in shown
 * below it: sent to GitHub's bug form, or copied for a chat or an email.
 * Nothing leaves without a button pressed.
 */
export function ReportProblemHost({
  t,
  settings,
}: {
  t: Strings;
  settings: Settings;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [facts, setFacts] = useState<ReportFacts | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    listeners.add(setOpen);
    return () => {
      listeners.delete(setOpen);
    };
  }, []);
  useEffect(() => {
    if (!open) return;
    setCopied(false);
    systemIpc
      .info()
      .catch(() => ({ os: navigator.platform, arch: "", webview: "" }))
      .then((info) =>
        setFacts({ ...info, language: settings.language, settings }),
      );
  }, [open, settings]);
  const close = () => setOpen(false);
  const presence = usePresence(open, { exitMs: 150 });
  const dialog = useModalDialog(close, open, ".report-problem-text");
  if (!presence.mounted) return null;
  const details = facts ? reportDetails(facts) : "";
  return (
    <div
      ref={presence.ref}
      data-state={presence.state}
      inert={presence.state === "closing" || undefined}
      className="close-prompt-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        className="close-prompt app-dialog report-problem"
        {...dialog}
        role="dialog"
        aria-modal="true"
        aria-label={t.reportTitle}
      >
        <h2 className="app-dialog-title app-dialog-info">{t.reportTitle}</h2>
        <textarea
          className="report-problem-text"
          aria-label={t.reportWhat}
          placeholder={t.reportWhat}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="report-problem-label">{t.reportDetails}</div>
        <pre className="report-problem-details">{details}</pre>
        <div className="close-prompt-buttons">
          <div className="close-prompt-spacer" />
          <button className="app-dialog-cancel" onClick={close}>
            {t.cancel}
          </button>
          <button
            disabled={!facts}
            onClick={() => {
              const all = text.trim()
                ? `${text.trim()}\n\n${details}`
                : details;
              void navigator.clipboard.writeText(all).then(
                () => setCopied(true),
                () => {},
              );
            }}
          >
            {copied ? t.reportCopied : t.reportCopy}
          </button>
          <button
            className="close-prompt-primary"
            disabled={!facts}
            onClick={() => {
              if (!facts) return;
              void links.openWebLink(reportUrl(facts, text, details));
              close();
            }}
          >
            {t.reportOnGithub}
          </button>
        </div>
      </div>
    </div>
  );
}
