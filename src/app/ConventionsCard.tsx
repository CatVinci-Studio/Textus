import { useEffect, useState } from "react";
import { fs } from "../platform/ipc";
import { type Conventions } from "../platform/bindings/files";
import { updateProjectSettings } from "../storage/project-settings";
import { CornerToast } from "../engine/controls/CornerToast";
import {
  SAME_FOLDER,
  attachmentsFolderName,
  conventionsAppName,
} from "../prefs/image-folder";
import type { Settings } from "../prefs/settings-types";
import type { Strings } from "../i18n/strings";

/** The other app's picture folder and the user's, as the card names
 *  them; null when they agree, or pictures are uploaded. */
function picturesOf(
  found: Conventions,
  settings: Settings,
  t: Strings,
): { theirs: string; ours: string } | null {
  const rule = found.attachments?.value;
  if (rule === undefined || settings.imageStorageMode !== "local") return null;
  const ours =
    settings.imageFolder === SAME_FOLDER
      ? t.imageFolderSameFolder
      : `${settings.imageFolder.replace(/\/?$/, "")}/`;
  const theirs = attachmentsFolderName(rule, t);
  return theirs === ours ? null : { theirs, ours };
}

/** Folders already asked about in this window, answered or not. */
const asked = new Set<string>();

/**
 * Another app's picture folder found in the document's folder (an Obsidian
 * vault, VS Code's settings...): offered once on a corner card, never
 * applied by itself. Adopting writes it into the project's
 * .textus/settings.json, which then applies without asking; keeping the
 * current setting writes that it was turned down.
 */
export function ConventionsCard({
  path,
  settings,
  t,
}: {
  /** The document in front. */
  path: string | null;
  settings: Settings;
  t: Strings;
}) {
  const [offer, setOffer] = useState<{
    found: Conventions;
    root: string;
    app: string;
    theirs: string;
    ours: string;
  } | null>(null);
  useEffect(() => {
    if (!path || offer) return;
    let current = true;
    void fs
      .folderConventions(path)
      .then((c) => {
        const found = c.detected;
        const source = c.sources.find((s) => s.app !== "textus");
        if (!current || !found || !source || asked.has(source.root)) return;
        const pictures = picturesOf(found, settings, t);
        if (!pictures) return;
        asked.add(source.root);
        setOffer({ found, root: source.root, app: source.app, ...pictures });
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [path, offer, settings, t]);
  const answer = (follow: boolean) => {
    if (!offer) return;
    const { found, root } = offer;
    setOffer(null);
    void updateProjectSettings(root, "conventions", (now) =>
      follow
        ? {
            ...now,
            attachments: found.attachments?.value,
            detected: "followed",
          }
        : { ...now, detected: "declined" },
    ).catch(() => {});
  };
  const app = offer ? conventionsAppName(offer.app) : "";
  const line = offer
    ? t.conventionsCardLine
        .replace("{app}", app)
        .replace("{folder}", offer.theirs)
    : "";
  return (
    <CornerToast
      show={!!offer}
      name="conventions-card"
      label={line}
      line={line}
      details={
        offer && t.conventionsCardDetails.replace("{current}", offer.ours)
      }
      actions={[
        {
          label: t.conventionsFollow,
          onSelect: () => answer(true),
          primary: true,
        },
        { label: t.conventionsDecline, onSelect: () => answer(false) },
      ]}
    />
  );
}
