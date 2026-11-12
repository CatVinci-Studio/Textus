import { useEffect, useRef } from "react";
import { codeBlockChanged, type CodeBlockSeen } from "../manager";
import {
  codeBlockAtInterfaceSize,
  trackCodeBlock,
  untrackCodeBlock,
} from "../contributions/code-blocks";
import { PluginProblem } from "./PluginProblem";
import { PluginWebview, useResolvedWebview } from "./PluginWebview";

const MAX_CODE_BLOCK_HEIGHT = 1200;
const CODE_BLOCK_SHARE = 0.7;
const codeBlockMax = () =>
  Math.min(
    MAX_CODE_BLOCK_HEIGHT,
    Math.round(window.innerHeight * CODE_BLOCK_SHARE),
  );

/**
 * A code block a plugin draws in the document: made once in sight, told when
 * its source changes, and able to change it through `setSource`.
 */
export function PluginCodeBlock({
  plugin,
  widget,
  seen,
  setSource,
  zoom = 1,
}: {
  plugin: string;
  /** The editor's widget it is drawn in: the same one while it lives. */
  widget: string;
  seen: CodeBlockSeen;
  setSource: (source: string) => boolean;
  /** The block's own size (its fence's `zoom=`), times the document's. */
  zoom?: number;
}) {
  const { record, error } = useResolvedWebview(plugin, "codeBlock", widget, {
    codeBlock: seen,
  });
  const latest = useRef(setSource);
  latest.current = setSource;
  useEffect(() => {
    if (!record) return;
    trackCodeBlock(record.id, {
      plugin,
      setSource: (source) => latest.current(source),
    });
    return () => untrackCodeBlock(record.id);
  }, [record, plugin]);
  // What it was made with is the plugin's already.
  const meta = JSON.stringify(seen.meta);
  const told = useRef({ source: seen.source, block: seen.block, meta });
  useEffect(() => {
    if (!record) return;
    const now = { source: seen.source, block: seen.block, meta };
    if (
      told.current.source === now.source &&
      told.current.block === now.block &&
      told.current.meta === now.meta
    )
      return;
    told.current = now;
    codeBlockChanged(record, { ...now, meta: JSON.parse(meta) });
  }, [record, seen.source, seen.block, meta]);
  if (error) return <PluginProblem error={error} />;
  if (!record) return null;
  return (
    <PluginWebview
      id={record.id}
      className="plugin-code-block-frame"
      fitHeight={codeBlockMax}
      zoom={zoom}
      interfaceSize={codeBlockAtInterfaceSize(seen.language)}
    />
  );
}
