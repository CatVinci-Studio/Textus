import { Component, Suspense, type ErrorInfo, type ReactNode } from "react";
import { resolveStrings } from "../../i18n/strings";
import { loadSettings } from "../../prefs/SettingsContext";
import { ReportProblemDialog } from "./report-open";
import "./AppErrorBoundary.css";

/** Lines of each trace a report carries: enough to find the place, short
 *  enough to read. */
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

interface State {
  error: Error | null;
  components: string | null;
  reporting: boolean;
}

/**
 * A render error anywhere takes the window down with it: without this the
 * page goes blank and nothing answers. What broke is said, with a way back
 * and Report a Problem, its details carrying where it broke.
 */
export class AppErrorBoundary extends Component<
  { children: ReactNode },
  State
> {
  state: State = { error: null, components: null, reporting: false };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(_error: Error, info: ErrorInfo) {
    this.setState({ components: info.componentStack ?? null });
  }

  render() {
    const { error, components, reporting } = this.state;
    if (!error) return this.props.children;
    const settings = loadSettings();
    const t = resolveStrings(settings.language);
    const message = error.message || String(error);
    return (
      <div className="app-error" role="alert">
        <h1>{t.appErrorTitle}</h1>
        <p className="app-error-detail">{message}</p>
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
            onClick={() => this.setState({ reporting: true })}
          >
            {t.reportTitle}
          </button>
        </div>
        {reporting && (
          <Suspense fallback={null}>
            <ReportProblemDialog
              t={t}
              settings={settings}
              open
              onClose={() => this.setState({ reporting: false })}
              crash={{ message, details: crashDetails(error, components) }}
            />
          </Suspense>
        )}
      </div>
    );
  }
}
