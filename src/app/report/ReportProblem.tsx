import { isError } from "../../utils/error-text";
import { fill } from "../../i18n/fill";
import { useEffect, useState } from "react";
import type { Strings, TextKey } from "../../i18n/strings";
import { links, systemIpc } from "../../platform/ipc";
import { usePresence } from "../../engine/motion/usePresence";
import { useModalDialog } from "../../engine/controls/useModalDialog";
import { Select } from "../../engine/controls/Select";
import type { Settings } from "../../prefs/settings-types";
import { explainError } from "../../utils/error-explain";
import {
  REPORT_AREAS,
  REPORT_KINDS,
  REPORT_SEVERITIES,
  reportDetails,
  reportPayload,
  reportUrl,
  type ReportChoice,
  type ReportFacts,
} from "./report";
import "./ReportProblem.css";
import { DialogActions } from "../../engine/controls/DialogActions";

const KIND_TEXT: Record<ReportChoice["kind"], TextKey> = {
  bug: "reportKindBug",
  idea: "reportKindIdea",
  question: "reportKindQuestion",
};
const AREA_TEXT: Record<ReportChoice["area"], TextKey> = {
  editor: "reportAreaEditor",
  ai: "reportAreaAi",
  plugins: "reportAreaPlugins",
  panes: "reportAreaPanes",
  export: "reportAreaExport",
  files: "reportAreaFiles",
  other: "reportAreaOther",
};
const SEVERITY_TEXT: Record<ReportChoice["severity"], TextKey> = {
  blocker: "reportSeverityBlocker",
  major: "reportSeverityMajor",
  minor: "reportSeverityMinor",
};

/** A crash the report is about: its message, and what broke where. */
export interface ReportCrash {
  message: string;
  details: string;
}

/**
 * What went wrong, in the user's words, with what Textus fills in shown
 * below it: sent to be filed as an issue, opened in GitHub's form, or
 * copied for a chat or an email. Nothing leaves without a button pressed.
 */
export function ReportProblemDialog({
  t,
  settings,
  open,
  onClose,
  crash,
}: {
  t: Strings;
  settings: Settings;
  open: boolean;
  onClose: () => void;
  /** The window's crash (AppErrorBoundary): its trace is in the details,
   *  and its message says what happened when the user writes nothing. */
  crash?: ReportCrash;
}) {
  const [facts, setFacts] = useState<ReportFacts | null>(null);
  useEffect(() => {
    if (!open) return;
    systemIpc
      .info()
      .catch(() => ({ os: navigator.platform, arch: "", webview: "" }))
      .then((info) =>
        setFacts({ ...info, language: settings.language, settings }),
      );
  }, [open, settings]);
  const close = onClose;
  const presence = usePresence(open);
  const dialog = useModalDialog(close, open, ".report-problem-text");
  if (!presence.mounted) return null;
  return (
    <div
      ref={presence.ref}
      data-state={presence.state}
      inert={presence.state === "closing" || undefined}
      className="tx-backdrop"
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
        <ReportForm t={t} facts={facts} close={close} crash={crash} />
      </div>
    </div>
  );
}

type Phase =
  | { state: "idle" | "sending" | "copied" }
  | { state: "sent"; url: string; number: number }
  | { state: "failed"; why: string };

function ReportForm({
  t,
  facts,
  close,
  crash,
}: {
  t: Strings;
  facts: ReportFacts | null;
  close: () => void;
  crash?: ReportCrash;
}) {
  const [text, setText] = useState("");
  const [contact, setContact] = useState("");
  const [choice, setChoice] = useState<ReportChoice>({
    kind: "bug",
    area: "editor",
    severity: "major",
  });
  const [phase, setPhase] = useState<Phase>({ state: "idle" });
  const details = facts
    ? [crash?.details, reportDetails(facts)].filter(Boolean).join("\n")
    : "";
  // What happened: the user's words, else the crash's message.
  const said = text.trim() || crash?.message || "";
  const ready = !!facts && said.length >= 5;

  if (phase.state === "sent")
    return (
      <>
        <p className="report-problem-sent">
          {fill(t.reportSent, { number: String(phase.number) })}
        </p>
        <DialogActions>
          <button
            className="tx-button"
            onClick={() => void links.openWebLink(phase.url)}
          >
            {t.reportView}
          </button>
          <button
            className="tx-button primary close-prompt-primary"
            onClick={close}
          >
            {t.hoverClose}
          </button>
        </DialogActions>
      </>
    );

  const send = async () => {
    if (!facts) return;
    setPhase({ state: "sending" });
    try {
      const sent = await systemIpc.sendReport(
        reportPayload(facts, choice, said, details, contact),
      );
      setPhase({ state: "sent", ...sent });
    } catch (err) {
      setPhase({
        state: "failed",
        why: isError(err, "sendLimit")
          ? explainError(err, t)
          : `${t.reportFailed} ${explainError(err, t)}`,
      });
    }
  };
  const pick = (
    label: string,
    value: string,
    options: readonly string[],
    names: Record<string, TextKey>,
    set: (value: string) => void,
  ) => (
    <label className="report-problem-choice">
      <span>{label}</span>
      <Select
        className="settings-select"
        value={value}
        onChange={(e) => set(e.target.value)}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {t[names[option]]}
          </option>
        ))}
      </Select>
    </label>
  );

  return (
    <>
      <div className="report-problem-choices">
        {pick(t.reportKindLabel, choice.kind, REPORT_KINDS, KIND_TEXT, (v) =>
          setChoice({ ...choice, kind: v as ReportChoice["kind"] }),
        )}
        {pick(t.reportAreaLabel, choice.area, REPORT_AREAS, AREA_TEXT, (v) =>
          setChoice({ ...choice, area: v as ReportChoice["area"] }),
        )}
        {choice.kind === "bug" &&
          pick(
            t.reportSeverityLabel,
            choice.severity,
            REPORT_SEVERITIES,
            SEVERITY_TEXT,
            (v) =>
              setChoice({ ...choice, severity: v as ReportChoice["severity"] }),
          )}
      </div>
      <textarea
        className="tx-input report-problem-text"
        aria-label={t.reportWhat}
        placeholder={t.reportWhat}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <input
        className="tx-input report-problem-contact"
        aria-label={t.reportContact}
        placeholder={t.reportContact}
        value={contact}
        maxLength={200}
        onChange={(e) => setContact(e.target.value)}
      />
      <div className="report-problem-label">{t.reportDetails}</div>
      <pre className="report-problem-details">{details}</pre>
      {phase.state === "failed" && (
        <p className="report-problem-note" role="status">
          {phase.why}
        </p>
      )}
      <DialogActions
        start={
          <button
            className="tx-button"
            disabled={!facts}
            onClick={() => {
              const all = text.trim()
                ? `${text.trim()}\n\n${details}`
                : details;
              void navigator.clipboard.writeText(all).then(
                () => setPhase({ state: "copied" }),
                () => {},
              );
            }}
          >
            {phase.state === "copied" ? t.codeBlockCopied : t.reportCopy}
          </button>
        }
      >
        <button
          className="tx-button"
          disabled={!facts}
          onClick={() => {
            if (!facts) return;
            void links.openWebLink(reportUrl(facts, said, details));
            close();
          }}
        >
          {t.reportOnGithub}
        </button>
        <button
          className="tx-button primary close-prompt-primary"
          disabled={!ready || phase.state === "sending"}
          onClick={() => void send()}
        >
          {phase.state === "sending" ? t.reportSending : t.reportSend}
        </button>
      </DialogActions>
    </>
  );
}
