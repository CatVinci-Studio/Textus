import { Suspense } from "react";
import { lazyModule } from "../../lazy/lazy-module";
import { lazyComponent } from "../../lazy/lazy-component";
import {
  DocSourceEditor,
  TextFileEditor,
} from "../../editor/modes/lazy-doc-source-editor";
import { textFileOf } from "../../files/document-name";
import { basename } from "../../utils/path";
import type { DocTab } from "../../document/doc-tabs";
import { tabReadOnly } from "../../document/read-only";
import { useSourceDocumentAccess } from "../../document-view/plugins/useSourceDocumentAccess";

const SplitView = lazyComponent(
  lazyModule("split-view", () => import("../../editor/modes/SplitView")),
  (m) => m.SplitView,
);

/** A tab in Source Mode or Source and Preview: one document for plugins
 *  across both, so switching between them registers nothing twice. A text
 *  file that isn't a document is always here, as plain text. */
export function SourceTabView({
  tab,
  isActive,
  typewriter,
  onChange,
}: {
  tab: DocTab;
  isActive: boolean;
  typewriter: boolean;
  onChange: (tabId: string, markdown: string) => void;
}) {
  const reported = useSourceDocumentAccess({
    tabId: tab.id,
    content: tab.content,
    filePath: tab.path,
    isActive,
    readOnly: tabReadOnly(tab),
    onChange: (markdown) => onChange(tab.id, markdown),
  });
  const textFile = textFileOf(tab.path);
  return (
    <Suspense fallback={null}>
      {textFile && tab.path ? (
        <TextFileEditor
          // Another language (its plugin turned on or off) is a new editor.
          key={`${textFile.language}`}
          tabId={tab.id}
          value={tab.content}
          fileName={basename(tab.path)}
          language={textFile.language}
          typewriter={typewriter}
          onChange={reported}
          readOnly={tabReadOnly(tab)}
        />
      ) : tab.splitView ? (
        <SplitView
          tabId={tab.id}
          content={tab.content}
          filePath={tab.path}
          typewriter={typewriter}
          onChange={reported}
          readOnly={tabReadOnly(tab)}
        />
      ) : (
        <DocSourceEditor
          tabId={tab.id}
          value={tab.content}
          docPath={tab.path}
          typewriter={typewriter}
          onChange={reported}
          readOnly={tabReadOnly(tab)}
        />
      )}
    </Suspense>
  );
}
