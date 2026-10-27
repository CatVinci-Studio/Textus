import { useEditorSetup } from "./useEditorSetup";
import { useAskAi } from "../ai/chat/ask-ai";
import { useEditorChat } from "./useEditorChat";
import { useEditorCarets, useEditorPopups } from "./useEditorPopups";
import { useEditorReview } from "./useEditorReview";
import { EditorMarginLayer } from "./EditorMarginLayer";
import { EditorOverlays } from "./EditorOverlays";
import { EditorChatPortals } from "./EditorChatPortals";
import { usePhoneLayout } from "../ui/usePhoneLayout";
import { useSettings, type AgentMode } from "../settings/SettingsContext";
import type { TourAi } from "../utils/events";
import { Milkdown } from "@milkdown/react";
import "@milkdown/kit/prose/view/style/prosemirror.css";
import "../theme/content-base.css";
import "../editor/milkdown-theme.css";
import "../theme/content-themes.css";

interface MilkdownEditorProps {
  /** The owning tab, the key this editor is flushed under. */
  tabId: string;
  filePath: string | null;
  initialValue: string;
  onChange: (markdown: string) => void;
  /** The tab's display name, for the detached chat's title. Passed down:
   *  `filePath` is null for the bundled Help documents. */
  docTitle: string;
  /** Whether this is the tab the user is looking at; every tab stays
   *  mounted, and the detached chat follows the active one. */
  isActive?: boolean;
  /** The tour's AI on its practice tab, else null: muted, completion and
   *  the grammar check go quiet. */
  tour?: TourAi | null;
  /** The AI panel's mode the tour's lesson needs, on its practice tab. */
  tourMode?: AgentMode | null;
  /** Nothing may change the document (View › Read Only). */
  readOnly?: boolean;
}

/**
 * One tab's document: the editor, Textus AI's chats on it, caret handling,
 * what opens over it and reviewing it.
 */
export function MilkdownEditor({
  tabId,
  filePath,
  docTitle,
  initialValue,
  onChange,
  isActive = true,
  tour = null,
  tourMode = null,
  readOnly = false,
}: MilkdownEditorProps) {
  // iPhone: Quick Ask docks at the bottom of the screen instead.
  const phone = usePhoneLayout();
  const { t, settings } = useSettings();
  const context = { filePath, isActive, phone, settings, t };

  const setup = useEditorSetup({
    tabId,
    docTitle,
    initialValue,
    onChange,
    tour,
    readOnly,
    ...context,
  });
  const chat = useEditorChat({ setup, docTitle, ...context });
  useEditorCarets({
    setup,
    tabId,
    isActive,
    initialValue,
    typewriter: settings.typewriterMode,
  });
  const popups = useEditorPopups({ setup, chat, tour, ...context });
  const review = useEditorReview({ setup, chat, popups, tour, ...context });
  const { grammar, lastTouchRef } = popups;
  // "Edit with AI" on a plugin's page: this panel, in Create mode.
  const askedMode = useAskAi(isActive, chat.agentPanel.setOpen);
  const { notes } = review;

  return (
    <div
      ref={review.rootRef}
      onContextMenu={popups.onContextMenu}
      onKeyDown={popups.onKeyDown}
      // iOS fires mouseover on a tap; there the caret opens the suggestion.
      onMouseOver={
        phone
          ? undefined
          : (e) => {
              grammar.onMouseOver(e);
              notes.hoverNotes(e.target as HTMLElement);
            }
      }
      onMouseOut={phone ? undefined : grammar.onMouseOut}
      // Out of the editor altogether: nothing is under the pointer.
      onMouseLeave={
        phone || !notes.hotNote ? undefined : () => notes.setNoteHot(null)
      }
      onPointerDown={() => (lastTouchRef.current = Date.now())}
      onPointerUp={() => (lastTouchRef.current = Date.now())}
    >
      <Milkdown />
      <EditorMarginLayer
        chat={chat}
        review={review}
        isActive={isActive}
        phone={phone}
        quickAskVisible={setup.inlineChat.visible}
        t={t}
      />
      <EditorOverlays
        setup={setup}
        chat={chat}
        popups={popups}
        review={review}
        phone={phone}
        inTour={tour !== null}
        settings={settings}
        t={t}
      />
      <EditorChatPortals
        setup={setup}
        chat={chat}
        review={review}
        filePath={filePath}
        phone={phone}
        tourMode={tourMode ?? askedMode}
        settings={settings}
        t={t}
      />
    </div>
  );
}
