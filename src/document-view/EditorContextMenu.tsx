import type { EditorRunner } from "../editor/useEditorRunner";
import type { EditorClipboard } from "../editor/clipboard/useEditorClipboard";
import {
  buildContextMenuItems,
  buildPhoneMoreItems,
  type ContextMenuOptions,
} from "../editor/editor-menu";
import { ContextMenu } from "../engine/controls/ContextMenu";
import { Presence } from "../engine/motion/usePresence";
import type { Settings } from "../prefs/SettingsContext";
import { aiFeatures } from "../prefs/ai-features";
import type { Strings } from "../i18n/strings";
import type { ImageLocation } from "../editor/images/missing-image";
import { useImageService } from "../ai/image-models";
import { selectImage } from "../editor/editor-menu";
import type { MenuLink } from "../editor/editor-menu-links";
import type { DrawnBlockActions } from "../editor/drawn-block-actions";

/** Where the editor's menu is open, and on what. */
export type EditorMenuState = {
  x: number;
  y: number;
  imagePos: number | null;
  /** Where the right-clicked picture's file is. */
  imageLocation?: ImageLocation | null;
  /** The plugin's drawing right-clicked, if any. */
  drawnBlock?: DrawnBlockActions | null;
  /** The link right-clicked, if any. */
  link?: MenuLink | null;
  /** Opened by the iPhone keyboard toolbar's "More", as an action sheet. */
  phone?: boolean;
  /** Opened from the keyboard, at the caret. */
  keyboard?: boolean;
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
  clipboard,
  openFindReplace,
  openTableDialog,
  own,
  onClose,
}: {
  menu: EditorMenuState;
  run: EditorRunner;
  t: Strings;
  settings: Settings;
  /** This is the tour's practice tab. */
  inTour: boolean;
  openAgentConversation: () => void;
  /** Asks Textus AI for a picture for the paragraph. */
  illustrateParagraph: (at: { x: number; y: number }) => void;
  triggerCompletion: () => void;
  triggerGrammarCheck: () => void;
  clipboard: EditorClipboard;
  openFindReplace: () => void;
  openTableDialog: () => void;
  /** The writer's own items: a note on the selection, and accepting or
   *  rejecting all their tracked changes. */
  own: Pick<ContextMenuOptions, "addNote" | "ownChanges">;
  onClose: () => void;
}) {
  const ai = aiFeatures(settings);
  const imageService = useImageService(settings);
  return (
    <Presence show={!!menu}>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          keyboard={menu.keyboard}
          items={(menu.phone ? buildPhoneMoreItems : buildContextMenuItems)(
            run,
            {
              t,
              imagePos: menu.imagePos,
              imageLocation: menu.imageLocation,
              drawnBlock: menu.drawnBlock,
              link: menu.link,
              // A picture is changed by asking for a new one in its place,
              // while there is an image service.
              pictureAiItems:
                ai.chat && imageService && menu.imagePos !== null && !menu.phone
                  ? [
                      {
                        label: t.changePictureWithAi,
                        onSelect: () => {
                          selectImage(run, menu.imagePos!);
                          openAgentConversation();
                        },
                      },
                    ]
                  : [],
              // Each AI item only while its feature is on, and none while
              // Textus AI is off. The tour's practice tab always offers Ask
              // AI so its lessons work.
              aiItems: [
                ...(aiFeatures(settings, inTour).chat && !menu.phone
                  ? [{ label: t.askAi, onSelect: openAgentConversation }]
                  : []),
                // A picture costs money: offered only while there is an
                // image service.
                ...(ai.chat && imageService
                  ? [
                      {
                        label: t.illustrateParagraph,
                        onSelect: () => illustrateParagraph(menu),
                      },
                    ]
                  : []),
                ...(ai.completion
                  ? [
                      {
                        label: t.triggerCompletion,
                        onSelect: triggerCompletion,
                      },
                    ]
                  : []),
                ...(ai.grammar
                  ? [
                      {
                        label: t.triggerGrammarCheck,
                        onSelect: triggerGrammarCheck,
                      },
                    ]
                  : []),
              ],
              ...clipboard,
              ...(!settings.plainTextMenu && {
                copyAsPlainText: undefined,
                pasteAsPlainText: undefined,
              }),
              openFindReplace,
              openTableDialog,
              ...own,
            },
          )}
          onClose={onClose}
        />
      )}
    </Presence>
  );
}
