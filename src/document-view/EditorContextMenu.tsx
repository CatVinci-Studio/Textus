import type { EditorRunner } from "../editor/useEditorRunner";
import {
  buildContextMenuItems,
  buildPhoneMoreItems,
} from "../editor/editor-menu";
import { ContextMenu } from "../editor/ContextMenu";
import { Presence } from "../ui/usePresence";
import type { Settings } from "../settings/SettingsContext";
import { aiFeatures } from "../settings/textus-ai";
import type { Strings } from "../i18n/strings";
import type { ImageLocation } from "../editor/images/missing-image";
import { useImageService } from "../ai/image-models";
import { selectImage } from "../editor/editor-menu";

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
  /** Opened from the keyboard, at the caret (ContextMenu's `keyboard`). */
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
  const ai = aiFeatures(settings);
  const imageService = useImageService(settings);
  return (
    <Presence show={!!menu} exitMs={250}>
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
              // A picture is changed by asking for a new one in its place
              // (generate_image's replace): Quick Ask on the picture, the
              // user saying how. While there is an image service.
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
              // Each AI item is only offered while its feature is enabled in
              // Settings, and none while Textus AI is off. The tour's
              // practice tab always offers Ask AI, so its AI lessons work
              // even for someone who turned Agent chat off before replaying
              // the tour from Help. The phone's "More" leaves it to the
              // toolbar's own button.
              aiItems: [
                ...(aiFeatures(settings, inTour).chat && !menu.phone
                  ? [{ label: t.askAi, onSelect: openAgentConversation }]
                  : []),
                // A picture costs money: offered while there is an image
                // service (Settings › Textus AI › Image model) - the chat
                // provider's own by default, none for one without.
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
