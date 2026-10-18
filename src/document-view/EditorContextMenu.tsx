import { editorViewCtx } from "@milkdown/kit/core";
import type { EditorRunner } from "../editor/useEditorRunner";
import {
  buildContextMenuItems,
  buildPhoneMoreItems,
} from "../editor/editor-menu";
import { ContextMenu } from "../editor/ContextMenu";
import { Presence } from "../ui/usePresence";
import type { Settings } from "../settings/SettingsContext";
import type { Strings } from "../i18n/strings";

/** Where the editor's menu is open, and on what. */
export type EditorMenuState = {
  x: number;
  y: number;
  imagePos: number | null;
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
  tutorialMock,
  openAgentConversation,
  generateSelectionImage,
  readSelection,
  triggerCompletion,
  triggerGrammarCheck,
  copyOrCut,
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
  tutorialMock: boolean;
  openAgentConversation: () => void;
  generateSelectionImage?: () => void;
  readSelection?: () => void;
  triggerCompletion: () => void;
  triggerGrammarCheck: () => void;
  copyOrCut: (cut: boolean) => void;
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
              // Each AI item is only offered while its feature is enabled in
              // Settings. The provider-free newcomer guide always exposes Ask
              // AI so its real right-click entry point remains available even
              // if the user previously disabled Agent chat before replaying
              // the guide from Help. The phone's "More" leaves it to the
              // toolbar's own button.
              aiItems: [
                ...(readSelection &&
                run((ctx) => !ctx.get(editorViewCtx).state.selection.empty)
                  ? [
                      {
                        label: settings.language.startsWith("zh")
                          ? "朗读所选文字"
                          : "Read selected text",
                        onSelect: readSelection,
                      },
                    ]
                  : []),
                ...(generateSelectionImage &&
                run((ctx) => !ctx.get(editorViewCtx).state.selection.empty)
                  ? [
                      {
                        label: settings.language.startsWith("zh")
                          ? "生成图片并插入选区下方"
                          : "Generate image below selection",
                        onSelect: generateSelectionImage,
                      },
                    ]
                  : []),
                ...((settings.enableAskAi || tutorialMock) && !menu.phone
                  ? [{ label: t.askAi, onSelect: openAgentConversation }]
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
