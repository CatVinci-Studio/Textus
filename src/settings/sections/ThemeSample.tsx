import { useEffect, useState, type CSSProperties } from "react";
import { themes } from "../../platform/ipc";
import {
  themeSample,
  type ThemeSample as Values,
} from "../../theme/theme-sample";

/** What a card draws for an installed theme with no screenshot: a heading,
 *  two lines of body and one accent, in the theme's page colour, text
 *  colour, heading font and accent. They are read from the theme's CSS as
 *  text (`themeSample`); that CSS is never put on the page, so the card
 *  can't be restyled by it. A value the theme doesn't set is left out and
 *  the current look's (`--doc-*`) shows through. */
export function ThemeSample({
  id,
  hasDark,
  dark,
}: {
  id: string;
  hasDark: boolean;
  /** The appearance in use; a theme with one design shows it in both. */
  dark: boolean;
}) {
  const design = dark && hasDark ? "dark" : "light";
  const [values, setValues] = useState<Values | null>(null);
  useEffect(() => {
    let cancelled = false;
    setValues(null);
    themes
      .loadThemeCss(id, design)
      .then((css) => {
        if (!cancelled && css) setValues(themeSample(css, dark && hasDark));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [id, design, dark, hasDark]);
  const style: Record<string, string> = {};
  if (values?.bg) style["--sample-bg"] = values.bg;
  if (values?.text) style["--sample-text"] = values.text;
  if (values?.accent) style["--sample-accent"] = values.accent;
  if (values?.font) style["--sample-font"] = values.font;
  return (
    <div
      className="theme-gallery-preview theme-sample"
      style={style as CSSProperties}
      aria-hidden
    >
      <span className="theme-sample-heading">Aa</span>
      <span className="theme-sample-line" />
      <span className="theme-sample-line is-short" />
      <span className="theme-sample-accent" />
    </div>
  );
}
