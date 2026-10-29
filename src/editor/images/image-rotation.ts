/**
 * An image's quarter turn, kept in its title suffix as `{textus-rotate=D}`
 * so the markdown stays standard. Older documents may hold the width in the
 * same braces (`{textus-width=50% textus-rotate=90}`, or `levis-` for
 * either); both parts are read, in any order.
 */
const IMAGE_TITLE_METADATA =
  /\s*\{((?:\s*(?:textus|levis)-(?:width=\d{1,3}%|rotate=\d{1,3}))+)\s*\}\s*$/;

export interface ImageTitleParts {
  /** The title as shown, without the suffix. */
  title: string;
  widthPercent: number | null;
  /** Clockwise, in degrees: 0, 90, 180 or 270. */
  rotate: number;
}

export function splitImageTitle(
  value: string | null | undefined,
): ImageTitleParts {
  const text = value ?? "";
  const match = IMAGE_TITLE_METADATA.exec(text);
  if (!match) return { title: text, widthPercent: null, rotate: 0 };
  const width = /-width=(\d{1,3})%/.exec(match[1]);
  const rotation = /-rotate=(\d{1,3})/.exec(match[1]);
  const percent = width ? Number(width[1]) : null;
  const degrees = rotation ? Number(rotation[1]) : 0;
  return {
    title: text.slice(0, match.index).trimEnd(),
    widthPercent:
      percent !== null && percent >= 1 && percent <= 100 ? percent : null,
    rotate: [90, 180, 270].includes(degrees) ? degrees : 0,
  };
}

/** `visibleTitle` with a rotation suffix; "" when there is neither. */
function titleWithRotation(visibleTitle: string, rotate: number): string {
  const suffix = rotate ? `{textus-rotate=${rotate}}` : "";
  return [visibleTitle.trimEnd(), suffix].filter(Boolean).join(" ");
}

/** `visibleTitle`, keeping the rotation `previousTitle` had. */
export function keepRotation(
  previousTitle: string | null | undefined,
  visibleTitle: string,
): string {
  return titleWithRotation(visibleTitle, splitImageTitle(previousTitle).rotate);
}

/** The title after a quarter turn clockwise (1) or counter-clockwise (-1).
 *  A width still kept in the title is left for the caller to move. */
export function turnedTitle(
  title: string | null | undefined,
  quarterTurns: number,
): string {
  const current = splitImageTitle(title);
  const rotate = (((current.rotate + quarterTurns * 90) % 360) + 360) % 360;
  return titleWithRotation(current.title, rotate);
}

/**
 * Shows an image node view's quarter turn: `data-rotate` on its wrapper,
 * which a quarter turn also gives the turned aspect ratio once the picture's
 * own is known (milkdown-theme.css). Call the returned function with each
 * title the view shows.
 */
export function imageRotationView(
  dom: HTMLElement,
  img: HTMLImageElement,
): (title: string | null | undefined) => void {
  const ratio = () => {
    if (!img.naturalWidth || !img.naturalHeight) return;
    dom.style.setProperty(
      "--image-ratio",
      String(img.naturalWidth / img.naturalHeight),
    );
    // Turned and unsized: as wide as the picture is tall.
    dom.style.setProperty("--image-turned-width", `${img.naturalHeight}px`);
  };
  img.addEventListener("load", ratio);
  return (title) => {
    const { rotate } = splitImageTitle(title);
    if (rotate) dom.dataset.rotate = String(rotate);
    else delete dom.dataset.rotate;
    dom.classList.toggle("image-view-turned", rotate === 90 || rotate === 270);
    ratio();
  };
}
