import { Component, type ErrorInfo, type ReactNode } from "react";
import { resolveStrings } from "../../i18n/strings";
import { loadSettings } from "../../prefs/SettingsContext";
import { links, systemIpc } from "../../platform/ipc";
import { reportDetails, reportUrl } from "./report";
import "./AppErrorBoundary.css";

/** Lines of each trace a report carries: enough to find the place, short
 *  enough for the issue form's address. */
const TRACE_LINES = 12;

/** What broke and where, for a report: the message, the code's trace and
 *  the components it broke in. */
export function crashDetails(error: Error, componentStack?: string | null) {
  const head = (text: string | undefined | null) =>
    (text ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, TRACE_LINES);
  const stack = head(error.stack);
  return [
    `Crash: ${error.message || String(error)}`,
    ...(stack.length ? ["Stack:", ...stack] : []),
    ...(componentStack ? ["Components:", ...head(componentStack)] : []),
  ].join("\n");
}

/**
 * A render error anywhere takes the window down with it: without this the
 * page goes blank and nothing answers. What broke is said, with a way back
 * and a report that carries where it broke.
 */
export class AppErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null; components: string | null }
> {
  state = { error: null as Error | null, components: null as string | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(_error: Error, info: ErrorInfo) {
    this.setState({ components: info.componentStack ?? null });
  }

  private report = async (error: Error) => {
    const settings = loadSettings();
    const info = await systemIpc
      .info()
      .catch(() => ({ os: navigator.platform, arch: "", webview: "" }));
    const facts = { ...info, language: settings.language, settings };
    const details = `${crashDetails(error, this.state.components)}\n${reportDetails(facts)}`;
    void links.openWebLink(reportUrl(facts, "", details));
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const t = resolveStrings(loadSettings().language);
    return (
      <div className="app-error" role="alert">
        <h1>{t.appErrorTitle}</h1>
        <p className="app-error-detail">{error.message || String(error)}</p>
        <div className="app-error-actions">
          <button
            type="button"
            className="app-error-reload"
            onClick={() => window.location.reload()}
          >
            {t.appErrorReload}
          </button>
          <button
            type="button"
            className="app-error-report"
            onClick={() => void this.report(error)}
          >
            {t.reportTitle}
          </button>
        </div>
      </div>
    );
  }
}
