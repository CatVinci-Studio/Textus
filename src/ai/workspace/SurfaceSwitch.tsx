import {
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { SparkleIcon } from "../../ui/icons";

/**
 * Agent | 写作: the window's one switch between the two surfaces, in the
 * same place in both (the window bar's start) - it replaced "← Agent" on
 * one side and "写作 →" on the other, which moved across the window as you
 * went. A highlight slides to the side that is on; ←/→ move it from the
 * keyboard, and the shortcut in its tooltip works from anywhere.
 */
export function SurfaceSwitch({
  agent,
  zh,
  docTitle,
  shortcut,
  onChange,
}: {
  /** The Agent surface is on (else Write). */
  agent: boolean;
  zh: boolean;
  /** Named in Write's accessible label: what it opens. */
  docTitle: string;
  /** The switch-surface shortcut, as shown (empty: none set). */
  shortcut: string;
  onChange: (agent: boolean) => void;
}) {
  const agentRef = useRef<HTMLButtonElement>(null);
  const writeRef = useRef<HTMLButtonElement>(null);
  const [thumb, setThumb] = useState<{ x: number; w: number } | null>(null);
  // The first placement is not animated: the highlight is just there.
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    const on = agent ? agentRef.current : writeRef.current;
    if (!on) return;
    const place = () =>
      setThumb((prev) =>
        prev?.x === on.offsetLeft && prev?.w === on.offsetWidth
          ? prev
          : { x: on.offsetLeft, w: on.offsetWidth },
      );
    place();
    // Labels change width when the language or the webfont settles.
    const sizes = new ResizeObserver(place);
    sizes.observe(on);
    return () => sizes.disconnect();
  }, [agent, zh]);
  useLayoutEffect(() => {
    if (!thumb || ready) return;
    const frame = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(frame);
  }, [thumb, ready]);

  const keys = (event: KeyboardEvent) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const toAgent = event.key === "ArrowLeft";
    onChange(toAgent);
    (toAgent ? agentRef : writeRef).current?.focus();
  };
  const hint = shortcut ? ` (${shortcut})` : "";
  return (
    <div
      className={`surface-switch${ready ? " is-ready" : ""}`}
      role="group"
      aria-label={zh ? "Agent 与写作" : "Agent and Write"}
      data-surface={agent ? "agent" : "write"}
      onKeyDown={keys}
    >
      {thumb && (
        <span
          className="surface-switch-thumb"
          aria-hidden
          style={{
            width: thumb.w,
            transform: `translateX(${thumb.x}px)`,
          }}
        />
      )}
      <button
        ref={agentRef}
        type="button"
        className="surface-switch-option is-agent"
        aria-pressed={agent}
        aria-label="Agent"
        title={(zh ? "Agent：对话、规划和起草" : "Agent: talk, plan and draft") + hint}
        tabIndex={agent ? 0 : -1}
        onClick={() => onChange(true)}
      >
        <SparkleIcon />
        <span>Agent</span>
      </button>
      <button
        ref={writeRef}
        type="button"
        className="surface-switch-option is-write"
        aria-pressed={!agent}
        aria-label={`${zh ? "写作" : "Write"} · ${docTitle}`}
        title={(zh ? "写作：直接编辑文档" : "Write: edit the document") + hint}
        tabIndex={agent ? -1 : 0}
        onClick={() => onChange(false)}
      >
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M10.5 2.8 13.2 5.5 6 12.7 2.8 13.2l.5-3.2z" />
          <path d="M9.2 4.1l2.7 2.7" />
        </svg>
        <span>{zh ? "写作" : "Write"}</span>
      </button>
    </div>
  );
}
