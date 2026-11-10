import { useLayoutEffect, useRef, type CSSProperties } from "react";
import { AgentIslandTools, AgentTabs } from "./AgentTabs";
import { TextusAiOffNote } from "../../ai/TextusAiSwitch";
import { setDockedPanelWidth } from "../../utils/hooks/useDockedPanelWidth";
import type { Strings } from "../../i18n/strings";

export interface AiIslandPlace {
  paneId: string;
  /** Its row's cell and its sheet's, in the split's grid. */
  bar?: CSSProperties;
  body?: CSSProperties;
  /** Its row is below another pane's, not the window bar's. */
  inner: boolean;
}

/**
 * The AI island in the documents' grid (MainPane), an island as any other:
 * its row of conversations (AgentTabs) over its sheet, which the active
 * tab's editor renders its conversation into (`mountRef`), History in its
 * corner. `state` plays it in and out as Textus AI's button opens and
 * closes it. Its width is told on: the window bar's title and the find bar
 * keep clear of it.
 */
export function AiIsland({
  place,
  state,
  mountRef,
  conversations,
  aiOn,
  sourceMode,
  onToggleSourceMode,
  onWidth,
  t,
}: {
  place: AiIslandPlace;
  state: string;
  mountRef: (el: HTMLElement | null) => void;
  /** The folder whose conversations its tabs are. */
  conversations: string | null;
  aiOn: boolean;
  /** The active tab is in source mode or split view: no conversation. */
  sourceMode: boolean;
  onToggleSourceMode: () => void;
  onWidth: (width: number) => void;
  t: Strings;
}) {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // What it takes of the window: from its edge to the window's, the gap
    // beyond it included.
    const tell = () => {
      const width = window.innerWidth - el.getBoundingClientRect().left;
      onWidth(width);
      setDockedPanelWidth(width);
    };
    tell();
    const resized = new ResizeObserver(tell);
    resized.observe(el);
    // Its slide in moves it without resizing it.
    window.addEventListener("resize", tell);
    el.addEventListener("animationend", tell);
    return () => {
      resized.disconnect();
      window.removeEventListener("resize", tell);
      el.removeEventListener("animationend", tell);
      onWidth(0);
      setDockedPanelWidth(0);
    };
  }, [onWidth]);
  return (
    <>
      {aiOn && (
        <AgentTabs
          scope={conversations}
          paneId={place.paneId}
          style={place.bar}
          inner={place.inner}
          t={t}
        />
      )}
      <section
        ref={ref}
        className="ai-island"
        aria-label={t.agentPanelTitle}
        data-state={state}
        data-islands=""
        data-pane-id={place.paneId}
        style={place.body}
        inert={state === "closing" || undefined}
      >
        <div
          className="agent-island"
          data-island=""
          data-pane-id={place.paneId}
        >
          <div className="agent-panel-mount" ref={mountRef} />
          {aiOn && <AgentIslandTools t={t} />}
          {/* Source mode, split view and AI off have no conversation, so
              say so instead of an empty column. */}
          {!aiOn && <TextusAiOffNote className="agent-panel-placeholder" />}
          {aiOn && sourceMode && (
            <div className="agent-panel-placeholder">
              <p>{t.agentPanelSourceMode}</p>
              <button
                type="button"
                className="text-button"
                onClick={onToggleSourceMode}
              >
                {t.agentPanelBackToEditor}
              </button>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
