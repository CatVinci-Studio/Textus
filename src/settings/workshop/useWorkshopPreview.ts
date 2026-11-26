import { useEffect, useState, type RefObject } from "react";
import type { Settings } from "../../prefs/SettingsContext";
import type { ThemeCss } from "../../theme/builtin-base";
import { useLatest } from "../../utils/hooks/useLatest";
import { paletteVariables } from "../../theme/workshop-palettes";
import { themeFontFaces } from "../../theme/supplied-font";
import {
  rule,
  typeFonts,
  typographyCss,
  type FontStacks,
  type TypeChoices,
} from "../../theme/theme-typography";
import {
  measureFrame,
  sampleHtml,
  setUpFrame,
  showBase,
  showRules,
} from "./preview-frame";

export type FrameMeasure = NonNullable<ReturnType<typeof measureFrame>>;

/** The column a theme's text sits in at most when it names no width of
 *  its own, and the editor's margins round it (block handles' room). */
const STANDARD_COLUMN = 760;
const GUTTERS = 88;

/**
 * The workshop's page: the sample in a frame of its own, so the theme being
 * built shows apart from the one in use and the reader's own settings. The
 * page is drawn once; a new starting theme swaps one stylesheet, and each
 * change to the controls only the workshop's rules. A frame narrower than
 * the column is shown scaled down, so the measure still reads true.
 */
export function useWorkshopPreview(
  frame: RefObject<HTMLIFrameElement | null>,
  settings: Settings,
  label: string,
  base: ThemeCss | null,
  dark: boolean,
  choices: TypeChoices,
): FrameMeasure | null {
  const [ready, setReady] = useState(false);
  const [measure, setMeasure] = useState<FrameMeasure | null>(null);
  const [rules, latestRules] = usePreviewRules(
    choices,
    dark && base?.dark != null,
    measure?.stacks,
  );
  const start = useLatest({ settings, label });

  useEffect(() => {
    let live = true;
    void sampleHtml(start.current.settings, start.current.label).then(
      (html) => {
        const doc = frame.current?.contentDocument;
        if (!live || !doc) return;
        setUpFrame(doc, html);
        setReady(true);
      },
    );
    return () => {
      live = false;
    };
  }, [frame, start]);

  useEffect(() => {
    const doc = frame.current?.contentDocument;
    if (!ready || !doc || !base) return;
    const css = dark && base.dark ? base.dark : base.light;
    showBase(doc, css, dark, base.dark !== null);
    showRules(doc, "");
    setMeasure(measureFrame(doc));
    showRules(doc, latestRules.current);
  }, [frame, ready, base, dark, latestRules]);

  useEffect(() => {
    const doc = frame.current?.contentDocument;
    if (ready && doc) showRules(doc, rules);
  }, [frame, ready, rules]);

  useFitColumn(
    frame,
    (choices.width ?? measure?.measures.width ?? STANDARD_COLUMN) + GUTTERS,
  );
  return measure;
}

/** The workshop's rules as the frame shows them. A width reaches the
 *  column at once; an installed theme's reaches it from its #write measure,
 *  read with its chrome. */
function previewRules(
  choices: TypeChoices,
  dark: boolean,
  stacks?: FontStacks,
): string {
  // Over the starting theme's chrome, which pins its own --doc-* colours;
  // an installed theme's chrome is derived with the palette's.
  const root = [
    ...paletteVariables(choices.palette, choices.syntax, dark).map(
      ([k, v]) => `${k}: ${v} !important`,
    ),
    ...(choices.width === null
      ? []
      : [`--theme-text-width: ${choices.width}px !important`]),
  ];
  return [typographyCss(choices, stacks), rule(":root", root)]
    .filter(Boolean)
    .join("\n\n");
}

/** The workshop's rules with the faces the chosen fonts are served from,
 *  as a saved theme carries them; and the latest, for an effect to read. */
function usePreviewRules(
  choices: TypeChoices,
  dark: boolean,
  stacks?: FontStacks,
): [string, { readonly current: string }] {
  // One per line, so an equal list doesn't ask again.
  const names = typeFonts(choices).join("\n");
  const [faces, setFaces] = useState("");
  useEffect(() => {
    let live = true;
    void themeFontFaces(names.split("\n")).then((css) => live && setFaces(css));
    return () => {
      live = false;
    };
  }, [names]);
  const rules = [faces, previewRules(choices, dark, stacks)]
    .filter(Boolean)
    .join("\n\n");
  return [rules, useLatest(rules)];
}

/** Scales the frame down when its box is narrower than `width`. */
function useFitColumn(
  frame: RefObject<HTMLIFrameElement | null>,
  width: number,
): void {
  useEffect(() => {
    const el = frame.current;
    const box = el?.parentElement;
    if (!el || !box || typeof ResizeObserver !== "function") return;
    const fit = () => {
      const room = box.clientWidth;
      const scale = room > 0 && room < width ? room / width : 1;
      el.style.width = `${room / scale}px`;
      el.style.height = `${box.clientHeight / scale}px`;
      el.style.transform = scale === 1 ? "" : `scale(${scale})`;
    };
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(box);
    return () => watch.disconnect();
  }, [frame, width]);
}
