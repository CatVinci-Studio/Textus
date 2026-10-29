import { useEffect, useState } from "react";
import type { Strings, TextKey } from "../../i18n/strings";
import { links, systemIpc } from "../../platform/ipc";
import { usePresence } from "../../ui/usePresence";
import { useModalDialog } from "../../ui/useModalDialog";
import { Select } from "../../ui/Select";
import type { Settings } from "../../prefs/settings-types";
import { errorText } from "../../utils/error-text";
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

const listeners = new Set<(open: boolean) => void>();

/** Help > Report a Problem. */
export function openReportProblem(): void {
  for (const listener of listeners) listener(true);
}

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

/**
 * What went wrong, in the user's words, with what Textus fills in shown
 * below it: sent to be filed as an issue, opened in GitHub's form, or
 * copied for a chat or an email. Nothing leaves without a button pressed.
 */
export function ReportProblemHost({
  t,
  settings,
}: {
  t: Strings;
  settings: Settings;
}) {
  const [open, setOpen] = useState(false);
  const [facts, setFacts] = useState<ReportFacts | null>(null);
  useEffect(() => {
    listeners.add(setOpen);
    return () => {
      listeners.delete(setOpen);
    };
  }, []);
  useEffect(() => {
    if (!open) return;
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
        <ReportForm t={t} facts={facts} close={close} />
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
}: {
  t: Strings;
  facts: ReportFacts | null;
  close: () => void;
}) {
  const [text, setText] = useState("");
  const [contact, setContact] = useState("");
  const [choice, setChoice] = useState<ReportChoice>({
    kind: "bug",
    area: "editor",
    severity: "major",
  });
  const [phase, setPhase] = useState<Phase>({ state: "idle" });
  const details = facts ? reportDetails(facts) : "";
  const ready = !!facts && text.trim().length >= 5;

  if (phase.state === "sent")
    return (
      <>
        <p className="report-problem-sent">
          {t.reportSent.replace("{number}", String(phase.number))}
        </p>
        <div className="close-prompt-buttons">
          <div className="close-prompt-spacer" />
          <button onClick={() => void links.openWebLink(phase.url)}>
            {t.reportView}
          </button>
          <button className="close-prompt-primary" onClick={close}>
            {t.hoverClose}
          </button>
        </div>
      </>
    );

  const send = async () => {
    if (!facts) return;
    setPhase({ state: "sending" });
    try {
      const sent = await systemIpc.sendReport(
        reportPayload(facts, choice, text, details, contact),
      );
      setPhase({ state: "sent", ...sent });
    } catch (err) {
      setPhase({
        state: "failed",
        why:
          errorText(err) === "LIMIT"
            ? t.reportLimit
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
      <Select value={value} onChange={(e) => set(e.target.value)}>
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
        className="report-problem-text"
        aria-label={t.reportWhat}
        placeholder={t.reportWhat}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <input
        className="report-problem-contact"
        aria-label={t.reportContact}
        placeholder={t.reportContact}
        value={contact}
        maxLength={200}
        onChange={(e) => setContact(e.target.value)}
      />
      <div className="report-problem-label">{t.reportDetails}</div>
      <pre className="report-problem-details">{details}</pre>
      <p className="report-problem-note" role="status">
        {phase.state === "failed" ? phase.why : t.reportPublic}
      </p>
      <div className="close-prompt-buttons">
        <button
          disabled={!facts}
          onClick={() => {
            const all = text.trim() ? `${text.trim()}\n\n${details}` : details;
            void navigator.clipboard.writeText(all).then(
              () => setPhase({ state: "copied" }),
              () => {},
            );
          }}
        >
          {phase.state === "copied" ? t.reportCopied : t.reportCopy}
        </button>
        <div className="close-prompt-spacer" />
        <button
          disabled={!facts}
          onClick={() => {
            if (!facts) return;
            void links.openWebLink(reportUrl(facts, text, details));
            close();
          }}
        >
          {t.reportOnGithub}
        </button>
        <button
          className="close-prompt-primary"
          disabled={!ready || phase.state === "sending"}
          onClick={() => void send()}
        >
          {phase.state === "sending" ? t.reportSending : t.reportSend}
        </button>
      </div>
    </>
  );
}
