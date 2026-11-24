import { useMemo, useRef } from "react";
import { flushEditor } from "../../editor/tab-editor";
import type { ChangeSource } from "../../editor/change-source";
import { tellDocumentChange } from "./plugin-events";
import {
  usePluginDocumentAccess,
  type PluginDocument,
} from "./usePluginDocumentAccess";

/**
 * A source or split tab's document as plugins reach it, as the rich editor's
 * is: its text and path, and its changes once typing pauses (the source
 * editor reports on the same pause). Returns what the source editor reports
 * its text to. Blocks, selection and edits are the rich editor's alone.
 */
export function useSourceDocumentAccess({
  tabId,
  content,
  filePath,
  isActive,
  readOnly,
  onChange,
}: {
  tabId: string;
  content: string;
  filePath: string | null;
  isActive: boolean;
  readOnly: boolean;
  onChange: (markdown: string) => void;
}): (markdown: string) => void {
  const latest = useRef({
    content,
    from: content,
    filePath,
    isActive,
    readOnly,
    onChange,
  });
  // The tab's text only once it changes: a render can lag a report.
  if (latest.current.from !== content)
    Object.assign(latest.current, { content, from: content });
  Object.assign(latest.current, { filePath, isActive, readOnly, onChange });

  const [document, report] = useMemo(() => {
    const report = (markdown: string, source: ChangeSource) => {
      const now = latest.current;
      now.content = markdown;
      now.onChange(markdown);
      tellDocumentChange(now.isActive, now.filePath, source);
    };
    const document: PluginDocument = {
      text: () => flushEditor(tabId) ?? latest.current.content,
      replace: (next) =>
        !latest.current.readOnly && (report(next, "plugin"), true),
      blocks: () => [],
      selection: () => ({ text: "", markdown: null }),
      cursor: () => null,
      propose: () => false,
      edit: () => false,
      reveal: () => false,
    };
    return [document, report] as const;
  }, [tabId]);
  usePluginDocumentAccess({ isActive, filePath, document });
  return (markdown) => report(markdown, "user");
}
