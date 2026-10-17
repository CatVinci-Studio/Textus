import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey, TextSelection } from "@milkdown/kit/prose/state";
import {
  Decoration,
  DecorationSet,
  type EditorView,
} from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import { isImeKeyEvent } from "../../editor/marks/enclosure";
import { ai } from "../../platform/ipc";
import { resolveStrings } from "../../i18n/strings";
import { isLang } from "../../i18n/langs";
import { WALKER_ARRIVED_EVENT } from "./footprint-gait";

const MAX_LINE_CHARS = 200;
const DWELL_MS = 10_000;
const FADE_MS = 520;
/** How long the page waits for the model; the drops of ink show meanwhile. */
const REPLY_BUDGET_MS = 15_000;
/** How long the page's "no answer" note stays before the line comes back. */
const FAILED_DWELL_MS = 3_500;
/** The walker hurries to the line, but the reply never waits on it for
 *  longer than this: it writes itself as the walker arrives. */
const ARRIVAL_GRACE_MS = 800;
/** A reply of any length is written in about this long; short ones go at
 *  the natural pace below and do not stretch to fill it. */
const WRITE_MS = 1_800;
const CHAR_MS = { latin: 30, cjk: 55, pause: 2.6 } as const;
/** One character's ink-in (milkdown-theme.css's .magic-diary-char). */
const CHAR_IN_MS = 460;
export const MAGIC_DIARY_EVENT = "textus:magic-diary";
export type MagicDiaryPhase = "absorbed" | "thinking" | "replying" | "leaving";
export interface MagicDiaryEvent {
  phase: MagicDiaryPhase;
  turnId?: number;
  at?: { left: number; top: number; width: number; height: number };
}
export interface MagicDiaryOptions {
  enabled: () => boolean;
  provider: () => string;
  model: () => string | null;
  uiLanguage: () => string;
}
interface Turn {
  id: number;
  from: number;
  to: number;
  line: string;
  reply: string;
  stage: "absorbing" | "writing" | "done" | "leaving";
  /** No answer came (no provider, offline, too slow): `reply` is the
   *  page's note saying so, and the line goes back on the page after it. */
  failed?: boolean;
}
interface DiaryState {
  turns: Turn[];
  active: number | null;
  browsing: number | null;
  composer: number;
}
type Meta =
  | { type: "absorb"; turn: Turn; composer: number }
  | { type: "reply"; id: number; text: string; failed?: boolean }
  | { type: "settle"; id: number }
  | { type: "leave"; id: number }
  | { type: "finish" }
  | { type: "cancel"; id: number }
  | { type: "browse"; index: number | null };
const key = new PluginKey<DiaryState>("magic-diary");
let serial = 0;
export function absorbableLine(
  doc: ProseNode,
  caret: number,
  after = -1,
): { textFrom: number; textTo: number; line: string } | null {
  if (caret < 0 || caret > doc.content.size) return null;
  const $pos = doc.resolve(caret);
  const parent = $pos.parent;
  if (parent.type.name !== "paragraph") return null;
  if ($pos.parentOffset !== parent.content.size) return null;
  const start = $pos.start($pos.depth);
  const textTo = $pos.end($pos.depth);
  const lineFrom = after >= start && after <= textTo ? after : start;
  const line = doc.textBetween(lineFrom, textTo, " ").trim();
  if (!line || line.length > MAX_LINE_CHARS) return null;
  return { textFrom: lineFrom, textTo, line };
}

/** Original prompts stay in the document for autosave and undo. Only the
 * current composer is visible; answers and history are ephemeral widgets. */
export function createMagicDiaryPlugin(options: MagicDiaryOptions) {
  let view: EditorView | null = null;
  let live: {
    id: number;
    requestId: string;
    arrived: boolean;
    reply?: string;
    failed?: boolean;
  } | null = null;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const widgets = new Map<string, HTMLElement>();
  function later(fn: () => void, ms: number) {
    const timer = setTimeout(() => {
      timers.delete(timer);
      fn();
    }, ms);
    timers.add(timer);
    return timer;
  }
  function clearTimers() {
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
  }
  function state() {
    return view ? key.getState(view.state) : undefined;
  }
  function isCurrent(id: number) {
    return (
      !!view && options.enabled() && live?.id === id && state()?.active === id
    );
  }
  function dispatch(meta: Meta) {
    if (view)
      view.dispatch(
        view.state.tr.setMeta(key, meta).setMeta("addToHistory", false),
      );
  }
  function announce(phase: MagicDiaryPhase) {
    if (!view || view.dom.closest('[data-active-tab="false"]')) return;
    const node = view.nodeDOM(state()?.composer ? state()!.composer - 1 : 0);
    const box =
      node instanceof HTMLElement
        ? node.getBoundingClientRect()
        : view.dom.getBoundingClientRect();
    window.dispatchEvent(
      new CustomEvent<MagicDiaryEvent>(MAGIC_DIARY_EVENT, {
        detail: {
          phase,
          turnId: live?.id,
          at: {
            left: box.left,
            top: box.top,
            width: box.width,
            height: box.height,
          },
        },
      }),
    );
  }
  function stopRequest() {
    clearTimers();
    if (live) void ai.cancelAgentMessage(live.requestId).catch(() => {});
    live = null;
  }
  function finish() {
    stopRequest();
    dispatch({ type: "finish" });
    widgets.clear();
    if (
      view &&
      options.enabled() &&
      !view.dom.closest('[data-active-tab="false"]')
    )
      view.focus();
  }
  /** Puts away an answer that has finished writing (so the reader can go
   *  on), and says whether there was one. */
  function putAwaySettled(): boolean {
    const current = state();
    const turn = current?.turns.find((t) => t.id === current.active);
    if (turn?.stage !== "done") return false;
    announce("leaving");
    if (turn.failed) restoreLine(turn);
    else finish();
    return true;
  }
  function leave(id: number) {
    if (!isCurrent(id)) return;
    announce("leaving");
    dispatch({ type: "leave", id });
    later(finish, FADE_MS);
  }
  function cancel(announceDeparture = true) {
    const current = state();
    const turn = current?.turns.find((t) => t.id === current.active);
    if (!turn || !view) return;
    if (announceDeparture) announce("leaving");
    if (turn.stage === "done" || turn.stage === "leaving") {
      finish();
      return;
    }
    restoreLine(turn);
  }
  /** Takes the turn back: removes the empty composer the turn inserted and
   *  puts the reader's line on the page again, caret at its end. */
  function restoreLine(turn: Turn) {
    const current = state();
    if (!current || !view) return;
    stopRequest();
    const tr = view.state.tr;
    const composerNode = tr.doc.nodeAt(current.composer - 1);
    if (composerNode?.isTextblock && !composerNode.content.size)
      tr.delete(
        current.composer - 1,
        current.composer - 1 + composerNode.nodeSize,
      );
    tr.setSelection(
      TextSelection.near(
        tr.doc.resolve(Math.min(turn.to - 1, tr.doc.content.size)),
      ),
    );
    tr.setMeta(key, { type: "cancel", id: turn.id } satisfies Meta).setMeta(
      "addToHistory",
      false,
    );
    view.dispatch(tr);
    widgets.clear();
    if (!view.dom.closest('[data-active-tab="false"]')) view.focus();
  }
  // The map has one walker across all mounted editors. A newly submitted
  // turn takes ownership; release the displaced turn without redirecting
  // the walker or stealing focus from its new tab.
  function onDiaryEvent(event: Event) {
    const { phase, turnId } = (event as CustomEvent<MagicDiaryEvent>).detail;
    if (phase === "absorbed" && live && turnId !== live.id) cancel(false);
  }
  async function ask(id: number, line: string) {
    if (!isCurrent(id) || !live) return;
    announce("thinking");
    const language = options.uiLanguage();
    const history = state()!
      .turns.filter((t) => t.id !== id && t.reply)
      .map((t) => ({ line: t.line, reply: t.reply }));
    const requestId = live.requestId;
    let budget: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<string>((resolve) => {
      budget = later(() => {
        void ai.cancelAgentMessage(requestId).catch(() => {});
        resolve("");
      }, REPLY_BUDGET_MS);
    });
    const request = ai
      .diaryReply({
        provider: options.provider(),
        model: options.model(),
        uiLanguage: language,
        line,
        history,
        requestId,
      })
      .then((text) => (typeof text === "string" ? text : ""))
      .catch(() => "");
    const reply = (await Promise.race([request, timeout])).trim();
    if (budget) {
      clearTimeout(budget);
      timers.delete(budget);
    }
    if (!isCurrent(id)) return;
    // Every answer is the model's. Without one the page says so, and the
    // line comes back to be sent again (see replyElement).
    live!.reply =
      reply || resolveStrings(isLang(language) ? language : "en").diaryNoAnswer;
    live!.failed = !reply;
    revealWhenReady();
  }
  function revealWhenReady() {
    if (!live || !isCurrent(live.id) || !live.arrived || !live.reply) return;
    const current = state()?.turns.find((turn) => turn.id === live!.id);
    if (current?.stage !== "absorbing") return;
    dispatch({
      type: "reply",
      id: live.id,
      text: live.reply,
      failed: live.failed,
    });
    announce("replying");
  }
  function onArrived(event: Event) {
    const { turnId } = (event as CustomEvent<{ turnId?: number }>).detail;
    if (!live || live.id !== turnId) return;
    live.arrived = true;
    revealWhenReady();
  }
  function replyElement(turn: Turn, browsing: boolean) {
    const widgetKey = `${turn.id}-${browsing ? "history" : "live"}`;
    const cached = widgets.get(widgetKey);
    if (cached) return cached;
    const wrap = document.createElement("span");
    wrap.className = `magic-diary-reply magic-diary-reply-${browsing ? "settled" : turn.stage}${turn.failed ? " magic-diary-reply-failed" : ""}`;
    wrap.contentEditable = "false";
    wrap.setAttribute("role", "status");
    wrap.setAttribute(
      "aria-label",
      options.uiLanguage().startsWith("zh") ? "日记的回答" : "Diary reply",
    );
    const ink = document.createElement("span");
    ink.className = "magic-diary-ink";
    wrap.appendChild(ink);
    widgets.set(widgetKey, wrap);
    if (browsing || turn.stage !== "writing") {
      ink.textContent = turn.reply;
      return wrap;
    }
    // The whole reply is laid out at once and each character only fades in
    // on its own delay: one layout, then compositor-only animation, instead
    // of a reflow (and a refit of the page) per character.
    const chars = Array.from(turn.reply);
    const weights = chars.map((ch) =>
      /[。，！？、,.!?；;：:]/.test(ch)
        ? CHAR_MS.pause
        : /[\u1100-\uffef]/.test(ch)
          ? CHAR_MS.cjk / CHAR_MS.latin
          : 1,
    );
    const natural = weights.reduce((sum, w) => sum + w, 0) * CHAR_MS.latin;
    const scale = natural > WRITE_MS ? WRITE_MS / natural : 1;
    let at = 0;
    const fragment = document.createDocumentFragment();
    chars.forEach((ch, i) => {
      const nib = document.createElement("span");
      nib.className = "magic-diary-char";
      nib.textContent = ch;
      nib.style.animationDelay = `${Math.round(at)}ms`;
      fragment.appendChild(nib);
      at += weights[i] * CHAR_MS.latin * scale;
    });
    ink.appendChild(fragment);
    later(() => {
      if (!isCurrent(turn.id) || !ink.isConnected) return;
      wrap.classList.remove("magic-diary-reply-writing");
      wrap.classList.add("magic-diary-reply-settled");
      dispatch({ type: "settle", id: turn.id });
      // Start the reading time only after the last character is written.
      // A note that no answer came gives the line back instead.
      if (turn.failed)
        later(() => {
          if (!isCurrent(turn.id)) return;
          announce("leaving");
          restoreLine(turn);
        }, FAILED_DWELL_MS);
      else later(() => leave(turn.id), DWELL_MS);
    }, at + CHAR_IN_MS);
    return wrap;
  }
  function decorations(doc: ProseNode, current: DiaryState) {
    const result: Decoration[] = [];
    for (const turn of current.turns) {
      if (turn.from >= 0 && turn.to <= doc.content.size && turn.to > turn.from)
        result.push(
          Decoration.node(turn.from, turn.to, {
            class: "magic-diary-archived",
          }),
        );
    }
    const turn =
      current.active !== null
        ? current.turns.find((t) => t.id === current.active)
        : current.browsing !== null
          ? current.turns.filter((t) => t.reply && t.stage === "done")[
              current.browsing
            ]
          : undefined;
    const composer = doc.nodeAt(current.composer - 1);
    if (turn && composer?.isTextblock) {
      result.push(
        Decoration.node(
          current.composer - 1,
          current.composer - 1 + composer.nodeSize,
          { class: "magic-diary-presenting" },
        ),
      );
      if (composer.content.size)
        result.push(
          Decoration.inline(
            current.composer,
            current.composer + composer.content.size,
            { class: "magic-diary-draft-hidden" },
          ),
        );
      if (turn.reply)
        result.push(
          Decoration.widget(
            current.composer,
            () => replyElement(turn, current.browsing !== null),
            {
              key: `reply-${turn.id}-${current.browsing !== null}`,
              side: -1,
              ignoreSelection: true,
            },
          ),
        );
      else
        result.push(
          Decoration.widget(
            current.composer,
            () => {
              const ghost = document.createElement("span");
              ghost.className = "magic-diary-ghost";
              ghost.textContent = turn.line;
              ghost.contentEditable = "false";
              return ghost;
            },
            { key: `ghost-${turn.id}`, side: -1, ignoreSelection: true },
          ),
          // Three drops of ink gathering where the answer will be, once the
          // line has lifted off: something is coming, even from a slow model.
          Decoration.widget(
            current.composer,
            () => {
              const wait = document.createElement("span");
              wait.className = "magic-diary-waiting";
              wait.contentEditable = "false";
              wait.setAttribute("aria-hidden", "true");
              for (let i = 0; i < 3; i++)
                wait.appendChild(document.createElement("i"));
              return wait;
            },
            { key: `wait-${turn.id}`, side: -1, ignoreSelection: true },
          ),
        );
    }
    return DecorationSet.create(doc, result);
  }
  const plugin = new Plugin<DiaryState>({
    key,
    state: {
      init: () => ({ turns: [], active: null, browsing: null, composer: 1 }),
      apply(tr, prev) {
        let next: DiaryState = {
          ...prev,
          composer: tr.mapping.map(prev.composer, -1),
          turns: prev.turns.flatMap((turn) => {
            const from = tr.mapping.map(turn.from, 1),
              to = tr.mapping.map(turn.to, -1);
            const node = tr.doc.nodeAt(from);
            return to > from &&
              node?.isTextblock &&
              to === from + node.nodeSize &&
              node.textContent.trim() === turn.line
              ? [{ ...turn, from, to }]
              : [];
          }),
        };
        // Undo or a document replacement may remove the active prompt.
        // Its request must lose ownership too, so input is never locked.
        if (
          next.active !== null &&
          !next.turns.some((t) => t.id === next.active)
        ) {
          next = {
            ...next,
            active: null,
            browsing: null,
            composer: tr.selection.$from.depth ? tr.selection.$from.start() : 1,
          };
        }
        if (!options.enabled()) {
          return {
            ...next,
            active: null,
            browsing: null,
            turns: next.turns.filter((t) => t.stage === "done"),
          };
        }
        const meta = tr.getMeta(key) as Meta | undefined;
        if (!meta) return tr.docChanged ? { ...next, browsing: null } : next;
        switch (meta.type) {
          case "absorb":
            next = {
              ...next,
              turns: [...next.turns, meta.turn],
              active: meta.turn.id,
              browsing: null,
              composer: meta.composer,
            };
            break;
          case "reply":
            next.turns = next.turns.map((t) =>
              t.id === meta.id
                ? {
                    ...t,
                    reply: meta.text,
                    stage: "writing",
                    failed: meta.failed,
                  }
                : t,
            );
            break;
          case "settle":
            next.turns = next.turns.map((t) =>
              t.id === meta.id ? { ...t, stage: "done" } : t,
            );
            break;
          case "leave":
            next.turns = next.turns.map((t) =>
              t.id === meta.id ? { ...t, stage: "leaving" } : t,
            );
            break;
          case "finish":
            next = {
              ...next,
              active: null,
              browsing: null,
              turns: next.turns.map((t) =>
                t.stage === "leaving" ? { ...t, stage: "done" } : t,
              ),
            };
            break;
          case "cancel":
            next = {
              ...next,
              turns: next.turns.filter((t) => t.id !== meta.id),
              composer: tr.selection.$from.depth
                ? tr.selection.$from.start()
                : 1,
              active: null,
              browsing: null,
            };
            break;
          case "browse":
            next.browsing = meta.index;
            break;
        }
        return next;
      },
    },
    props: {
      decorations(editorState) {
        return options.enabled()
          ? decorations(editorState.doc, key.getState(editorState)!)
          : DecorationSet.empty;
      },
      handleTextInput() {
        if (!options.enabled()) return false;
        if (putAwaySettled()) return false;
        if (state()?.active !== null) return true;
        if (state()?.browsing !== null)
          dispatch({ type: "browse", index: null });
        return false;
      },
      handlePaste() {
        return options.enabled() && state()?.active !== null;
      },
      handleDOMEvents: {
        beforeinput: (_view, event) => {
          // Typing (an IME's too) after the answer is written puts it away
          // and goes on with the next line, rather than waiting it out.
          if (options.enabled() && putAwaySettled()) return false;
          if (options.enabled() && state()?.active !== null) {
            event.preventDefault();
            return true;
          }
          return false;
        },
      },
      handleKeyDown(editorView, event) {
        if (!options.enabled() || isImeKeyEvent(editorView, event))
          return false;
        let current = key.getState(editorView.state)!;
        const active = current.turns.find((t) => t.id === current.active);
        if (
          active?.stage === "done" &&
          (event.key === "ArrowUp" || event.key === "ArrowDown") &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.altKey &&
          !event.shiftKey
        ) {
          announce("leaving");
          finish();
          // The answer being read is the newest history item. Start there
          // so Up selects the preceding answer and Down returns to input.
          dispatch({
            type: "browse",
            index:
              state()!.turns.filter((t) => t.reply && t.stage === "done")
                .length - 1,
          });
          current = key.getState(editorView.state)!;
        }
        if (current.active !== null) {
          if (event.key === "Escape") {
            event.preventDefault();
            cancel();
            return true;
          }
          // A written answer goes the moment the reader starts the next
          // line; until it is written, input waits.
          if (
            (event.key.length === 1 ||
              event.key === "Enter" ||
              event.key === "Backspace") &&
            !event.metaKey &&
            !event.ctrlKey &&
            !event.altKey &&
            putAwaySettled()
          )
            return event.key === "Enter" || event.key === "Backspace";
          if (!event.metaKey && !event.ctrlKey && !event.altKey) {
            event.preventDefault();
            return true;
          }
          return false;
        }
        if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey)
          return false;
        if (
          (event.key === "Backspace" || event.key === "ArrowLeft") &&
          editorView.state.selection.empty &&
          editorView.state.selection.from === current.composer &&
          current.turns.length
        ) {
          event.preventDefault();
          return true;
        }
        if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          const history = current.turns.filter(
            (t) => t.reply && t.stage === "done",
          );
          if (!history.length) return false;
          const index = current.browsing ?? history.length;
          const next =
            event.key === "ArrowUp"
              ? Math.max(0, index - 1)
              : Math.min(history.length, index + 1);
          event.preventDefault();
          dispatch({
            type: "browse",
            index: next === history.length ? null : next,
          });
          return true;
        }
        if (current.browsing !== null) {
          dispatch({ type: "browse", index: null });
          if (event.key === "Escape") {
            event.preventDefault();
            return true;
          }
        }
        if (event.key !== "Enter" || !editorView.state.selection.empty)
          return false;
        const at = absorbableLine(
          editorView.state.doc,
          editorView.state.selection.from,
        );
        if (!at || editorView.state.selection.$from.depth !== 1) return false;
        event.preventDefault();
        const id = ++serial;
        const tr = editorView.state.tr.split(at.textTo);
        const composer = at.textTo + 2;
        tr.setSelection(TextSelection.create(tr.doc, composer));
        tr.setMeta(key, {
          type: "absorb",
          composer,
          turn: {
            id,
            from: at.textFrom - 1,
            to: at.textTo + 1,
            line: at.line,
            reply: "",
            stage: "absorbing",
          },
        } satisfies Meta);
        editorView.dispatch(tr);
        live = { id, requestId: `diary-${Date.now()}-${id}`, arrived: false };
        announce("absorbed");
        later(() => {
          if (live?.id !== id) return;
          live.arrived = true;
          revealWhenReady();
        }, ARRIVAL_GRACE_MS);
        void ask(id, at.line);
        return true;
      },
    },
    view(editorView) {
      view = editorView;
      window.addEventListener(WALKER_ARRIVED_EVENT, onArrived);
      window.addEventListener(MAGIC_DIARY_EVENT, onDiaryEvent);
      const pane = editorView.dom.closest<HTMLElement>(".editor-scroll");
      const column = editorView.dom.closest<HTMLElement>(".editor-content");
      const paper = editorView.dom.closest<HTMLElement>(".milkdown");
      let frame = 0;
      let autofocus = true;
      let wasEnabled = options.enabled();
      // Kept outside contenteditable: WebKit's caret can stop blinking while
      // idle, and inserting a caret widget in the text interferes with IME.
      const caret = document.createElement("div");
      caret.className = "magic-diary-input-caret";
      caret.setAttribute("aria-hidden", "true");
      caret.hidden = true;
      document.body.appendChild(caret);
      const updateCaret = () => {
        if (!view) return;
        const current = state();
        const ready =
          options.enabled() &&
          current?.active === null &&
          current.browsing === null &&
          view.state.selection.empty &&
          !view.dom.closest('[data-active-tab="false"]') &&
          view.dom.getBoundingClientRect().width > 0;
        caret.hidden = !ready;
        view.dom.classList.toggle("magic-diary-has-caret", ready);
        if (!ready) return;
        try {
          const box = view.coordsAtPos(view.state.selection.head);
          caret.style.left = `${box.left}px`;
          caret.style.top = `${box.top + 2}px`;
          caret.style.height = `${Math.max(12, box.bottom - box.top - 4)}px`;
        } catch {
          caret.hidden = true;
          view.dom.classList.remove("magic-diary-has-caret");
        }
      };
      const onPaperPointerDown = (event: PointerEvent) => {
        if (
          !view ||
          !options.enabled() ||
          state()?.active !== null ||
          state()?.browsing !== null
        )
          return;
        if (
          event.target === pane ||
          event.target === column ||
          event.target === paper
        ) {
          event.preventDefault();
          view.focus();
          updateCaret();
        }
      };
      pane?.addEventListener("pointerdown", onPaperPointerDown);
      // Fit the entire passage, including at large editor zoom, rather than
      // turning the answer into a nested scroll area or clipping its end.
      const fit = () => {
        frame = 0;
        if (!view || !pane || !column || !paper) return;
        if (autofocus) {
          if (
            options.enabled() &&
            document.activeElement === document.body &&
            !view.dom.closest('[data-active-tab="false"]') &&
            !document.querySelector('[role="dialog"]')
          )
            view.focus();
          autofocus = false;
        }
        if (!options.enabled()) {
          paper.style.removeProperty("--diary-fit");
          updateCaret();
          return;
        }
        if (!pane.clientHeight) return;
        const style = getComputedStyle(column);
        const available = Math.max(
          40,
          pane.clientHeight -
            parseFloat(style.paddingTop) -
            parseFloat(style.paddingBottom),
        );
        paper.style.setProperty("--diary-fit", "1");
        let scale = 1;
        for (let i = 0; i < 6; i++) {
          const height = view.dom.getBoundingClientRect().height;
          if (height <= available) break;
          scale *= Math.min(0.9, available / height);
          paper.style.setProperty("--diary-fit", String(scale));
        }
        updateCaret();
      };
      const scheduleFit = () => {
        if (!frame && pane) frame = requestAnimationFrame(fit);
      };
      const observer =
        typeof ResizeObserver === "undefined"
          ? null
          : new ResizeObserver(scheduleFit);
      observer?.observe(editorView.dom);
      if (pane) observer?.observe(pane);
      scheduleFit();
      const update = () => {
        if (!view) return;
        const current = state()!;
        if (options.enabled() && !wasEnabled) autofocus = true;
        wasEnabled = options.enabled();
        updateCaret();
        scheduleFit();
        view.dom.classList.toggle(
          "magic-diary-busy",
          options.enabled() &&
            (current.active !== null || current.browsing !== null),
        );
        view.dom.setAttribute(
          "aria-busy",
          String(options.enabled() && current.active !== null),
        );
        const active = current.turns.find((t) => t.id === current.active);
        for (const el of widgets.values())
          el.classList.toggle(
            "magic-diary-reply-leaving",
            active?.stage === "leaving",
          );
        if (live && (!options.enabled() || !active)) {
          announce("leaving");
          stopRequest();
        }
      };
      update();
      return {
        update: () => update(),
        destroy() {
          observer?.disconnect();
          cancelAnimationFrame(frame);
          caret.remove();
          pane?.removeEventListener("pointerdown", onPaperPointerDown);
          view?.dom.classList.remove("magic-diary-has-caret");
          paper?.style.removeProperty("--diary-fit");
          window.removeEventListener(WALKER_ARRIVED_EVENT, onArrived);
          window.removeEventListener(MAGIC_DIARY_EVENT, onDiaryEvent);
          if (live) announce("leaving");
          stopRequest();
          widgets.clear();
          view = null;
        },
      };
    },
  });
  return $prose(() => plugin);
}
