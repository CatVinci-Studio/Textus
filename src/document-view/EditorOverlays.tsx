import { insertTable } from "../editor/editor-menu";
import { EditorContextMenu } from "./EditorContextMenu";
import type { EditorSetup } from "./useEditorSetup";
import type { EditorChat } from "./useEditorChat";
import type { EditorPopups } from "./useEditorPopups";
import type { EditorReview } from "./useEditorReview";
import { GrammarSuggestion } from "../ai/writing/GrammarSuggestion";
import { InsertTableDialog } from "../editor/tables/InsertTableDialog";
import { ImageNameDialog } from "../editor/images/ImageNameDialog";
import { FindReplaceBar } from "../editor/find/FindReplaceBar";
import { Presence, PresenceDiv } from "../ui/usePresence";
import type { Settings } from "../settings/SettingsContext";
import type { Strings } from "../i18n/strings";

/** What opens over one tab's editor (useEditorPopups): the find bar, its
 *  menu, the AI notice, the table and picture-name dialogs, and the
 *  grammar card. */
export function EditorOverlays({
  setup,
  chat,
  popups,
  review,
  phone,
  inTour,
  settings,
  t,
}: {
  setup: EditorSetup;
  chat: EditorChat;
  popups: EditorPopups;
  review: EditorReview;
  phone: boolean;
  inTour: boolean;
  settings: Settings;
  t: Strings;
}) {
  const { run, clipboard, notice } = setup;
  const { imageNameRequest, closeImageNameDialog } = setup.imageName;
  const { findReplace, tableDialogOpen, setTableDialogOpen } = popups;
  return (
    <>
      <Presence show={findReplace.open} exitMs={120}>
        {findReplace.open && (
          <FindReplaceBar findReplace={findReplace} labels={t} />
        )}
      </Presence>
      <EditorContextMenu
        menu={popups.menu}
        run={run}
        t={t}
        settings={settings}
        inTour={inTour}
        openAgentConversation={chat.controls.openAgentConversation}
        illustrateParagraph={review.illustrateParagraph}
        triggerCompletion={setup.triggerCompletion}
        triggerGrammarCheck={setup.triggerGrammarCheck}
        copyOrCut={clipboard.copyOrCut}
        copyAsMarkdown={clipboard.copyAsMarkdown}
        paste={clipboard.paste}
        selectAll={clipboard.selectAll}
        toggleFindReplace={findReplace.toggle}
        openTableDialog={() => setTableDialogOpen(true)}
        own={review.notes.menu}
        onClose={() => popups.setMenu(null)}
      />
      <Presence show={!!notice.aiNotice} exitMs={120}>
        {notice.aiNotice && (
          <PresenceDiv
            className="ai-notice floating-surface"
            role="status"
            onMouseEnter={notice.holdAiNotice}
            onMouseLeave={notice.releaseAiNotice}
          >
            {notice.aiNotice}
          </PresenceDiv>
        )}
      </Presence>
      <Presence show={tableDialogOpen} exitMs={120}>
        {tableDialogOpen && (
          <InsertTableDialog
            title={t.insertTable}
            rowsLabel={t.insertTableRowsLabel}
            columnsLabel={t.insertTableColumnsLabel}
            confirmLabel={t.insertTableConfirm}
            cancelLabel={t.closePromptCancel}
            onInsert={(rows, cols) => insertTable(run, rows, cols)}
            onClose={() => setTableDialogOpen(false)}
          />
        )}
      </Presence>
      <Presence show={!!imageNameRequest} exitMs={120}>
        {imageNameRequest && (
          <ImageNameDialog
            request={imageNameRequest}
            title={t.imageNameDialogTitle}
            label={t.imageNameDialogLabel}
            invalidLabel={t.imageNameDialogInvalid}
            uploadLabel={t.imageNameDialogUpload}
            cancelLabel={t.closePromptCancel}
            onClose={closeImageNameDialog}
          />
        )}
      </Presence>
      <GrammarSuggestion
        grammar={popups.grammar}
        phone={phone}
        t={t}
        onStale={() => notice.showAiNotice(t.grammarApplyStale)}
      />
    </>
  );
}
