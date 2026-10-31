import { Component, type ReactNode } from "react";
import { resolveStrings } from "../../i18n/strings";
import { loadSettings } from "../../prefs/SettingsContext";
import "./AppErrorBoundary.css";

/**
 * A render error anywhere takes the window down with it: without this the
 * page goes blank and nothing answers. What broke is said, with a way back.
 */
export class AppErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const t = resolveStrings(loadSettings().language);
    return (
      <div className="app-error" role="alert">
        <h1>{t.appErrorTitle}</h1>
        <p className="app-error-detail">{error.message || String(error)}</p>
        <button
          type="button"
          className="app-error-reload"
          onClick={() => window.location.reload()}
        >
          {t.appErrorReload}
        </button>
      </div>
    );
  }
}
