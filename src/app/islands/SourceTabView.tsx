import { Suspense } from "react";
import { lazyModule } from "../../lazy/lazy-module";
import { lazyComponent } from "../../lazy/lazy-component";
import { DocSourceEditor } from "../../editor/modes/lazy-doc-source-editor";
import type { DocTab } from "../../document/doc-tabs";
import { tabReadOnly } from "../../document/read-only";
import { useSourceDocumentAccess } from "../../document-view/plugins/useSourceDocumentAccess";

const SplitView = lazyComponent(
  lazyModule("split-view", () => import("../../editor/modes/SplitView")),
  (m) => m.SplitView,
);

/** A tab in Source Mode or Source and Preview: one document for plugins
 *  across both, so switching between them registers nothing twice. */
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
  return (
    <Suspense fallback={null}>
      {tab.splitView ? (
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
