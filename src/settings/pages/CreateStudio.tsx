import { Suspense, useState } from "react";
import type { Strings } from "../../i18n/strings";
import { useSettings } from "../../prefs/SettingsContext";
import { Segmented } from "../../engine/controls/Segmented";
import {
  requestCreate,
  type CreateRequest,
} from "../../ai/chat/create-request";
import { lazyComponent } from "../../lazy/lazy-component";
import { lazyModule } from "../../lazy/lazy-module";
import { CreateChat } from "./CreateChat";

// The workshop draws the editor and its own page: loaded when shown.
const ThemeWorkshop = lazyComponent(
  lazyModule("theme-workshop", () => import("../workshop/ThemeWorkshop")),
  (m) => m.ThemeWorkshop,
);

/** The conversation, or for a theme the workshop or describing it to the
 *  AI. */
type View = "chat" | "workshop" | "theme-ai";

/** Making a theme opens the workshop; words for the AI go to the
 *  conversation, on the theme's side of the switch if it was showing. */
function viewFor(request: CreateRequest, now: View): View {
  if (request.kind !== "theme") return "chat";
  if (!request.text) return "workshop";
  return now === "chat" ? "chat" : "theme-ai";
}

/**
 * Create: a conversation with the AI that makes a plugin, theme or skill.
 * Asked to make a theme, it opens on the theme workshop - no AI needed -
 * with describing the theme to the AI beside it. The conversation stays
 * while the workshop shows.
 */
export function CreateStudio({ t }: { t: Strings }) {
  const { settings } = useSettings();
  const [view, setView] = useState<View>("chat");
  // The theme the workshop opens on, and a count that opens it afresh.
  const [start, setStart] = useState<{ id?: string; n: number }>({ n: 0 });
  const toAi = (text: string) => {
    setView("theme-ai");
    requestCreate(text, "theme");
  };
  const head = view !== "chat" && settings.textusAi && (
    <div className="create-studio-switch">
      <Segmented
        kind="tabs"
        label={t.workshopModeLabel}
        value={view === "workshop" ? "workshop" : "theme-ai"}
        onChange={setView}
        options={[
          { id: "workshop", label: t.workshopModeOwn },
          { id: "theme-ai", label: t.workshopModeAi },
        ]}
      />
    </div>
  );
  return (
    <>
      {view === "workshop" && (
        <Suspense fallback={null}>
          <ThemeWorkshop
            key={start.n}
            t={t}
            head={head}
            start={start.id}
            onAskAi={toAi}
          />
        </Suspense>
      )}
      <CreateChat
        t={t}
        hidden={view === "workshop"}
        head={head}
        onRequest={(request) => {
          setView((now) => viewFor(request, now));
          if (request.kind === "theme" && !request.text)
            setStart((now) => ({ id: request.start, n: now.n + 1 }));
        }}
      />
    </>
  );
}
