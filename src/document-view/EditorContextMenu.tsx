import type { EditorRunner } from "../editor/useEditorRunner";
import {
  buildContextMenuItems,
  buildPhoneMoreItems,
} from "../editor/editor-menu";
import { ContextMenu } from "../editor/ContextMenu";
import { Presence } from "../ui/usePresence";
import type { Settings } from "../settings/SettingsContext";
import type { Strings } from "../i18n/strings";
import type { ImageLocation } from "../editor/images/missing-image";

/** Where the editor's menu is open, and on what. */
export type EditorMenuState = {
  x: number;
  y: number;
  imagePos: number | null;
  /** Where the right-clicked picture's file is (contextMenuTarget). */
  imageLocation?: ImageLocation | null;
  /** Opened by the iPhone keyboard toolbar's "More": the phone's items
   *  (buildPhoneMoreItems), as an action sheet. */
  phone?: boolean;
} | null;

/** The editor's right-click menu (and the phone's "More" sheet), with the
 *  AI items its Settings switch on. */
export function EditorContextMenu({
  menu,
  run,
  t,
  settings,
  inTour,
  openAgentConversation,
  illustrateParagraph,
  triggerCompletion,
  triggerGrammarCheck,
  copyOrCut,
  copyAsMarkdown,
  paste,
  selectAll,
  toggleFindReplace,
  openTableDialog,
  onClose,
}: {
  menu: EditorMenuState;
  run: EditorRunner;
  t: Strings;
  settings: Settings;
  /** This is the tour's practice tab. */
  inTour: boolean;
  openAgentConversation: () => void;
  /** Asks Textus AI for a picture for the paragraph (useIllustrateParagraph). */
  illustrateParagraph: (at: { x: number; y: number }) => void;
  triggerCompletion: () => void;
  triggerGrammarCheck: () => void;
  copyOrCut: (cut: boolean) => void;
  copyAsMarkdown: () => void;
  paste: () => void;
  selectAll: () => void;
  toggleFindReplace: () => void;
  openTableDialog: () => void;
  onClose: () => void;
}) {
  return (
    <Presence show={!!menu} exitMs={250}>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={(menu.phone ? buildPhoneMoreItems : buildContextMenuItems)(
            run,
            {
              t,
              imagePos: menu.imagePos,
              imageLocation: menu.imageLocation,
              // Each AI item is only offered while its feature is enabled in
              // Settings. The tour's practice tab always offers Ask AI, so
              // its AI lessons work even for someone who turned Agent chat
              // off before replaying the tour from Help. The phone's
              // "More" leaves it to the toolbar's own button.
              aiItems: [
                ...((settings.enableAskAi || inTour) && !menu.phone
                  ? [{ label: t.askAi, onSelect: openAgentConversation }]
                  : []),
                // A picture costs money: offered once an image model is
                // chosen (Settings › Textus AI › Image model).
                ...(settings.enableAskAi && settings.imageModelProvider
                  ? [
                      {
                        label: t.illustrateParagraph,
                        onSelect: () => illustrateParagraph(menu),
                      },
                    ]
                  : []),
                ...(settings.enableCompletion
                  ? [
                      {
                        label: t.triggerCompletion,
                        onSelect: triggerCompletion,
                      },
                    ]
                  : []),
                ...(settings.enableGrammarCheck
                  ? [
                      {
                        label: t.triggerGrammarCheck,
                        onSelect: triggerGrammarCheck,
                      },
                    ]
                  : []),
              ],
              copyOrCut,
              copyAsMarkdown,
              paste,
              selectAll,
              toggleFindReplace,
              openTableDialog,
            },
          )}
          onClose={onClose}
        />
      )}
    </Presence>
  );
}
