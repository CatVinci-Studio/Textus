import { markTime } from "../../ui/moves";
import { wholeBlockKind } from "./markdown-forms";
import { splitUnits } from "./unit-diff";

/**
 * New text a proposal brings, put into the document a unit at a time - a
 * sentence of a paragraph, or a whole block (a heading, a list item, a
 * table, a fence, a formula) - not typed out a character at a time: a unit
 * half written showed as its Markdown (`## ` before a heading came, an
 * empty bullet, a table's first row as text) and as blank lines while it
 * was laid out, and every frame redrew it under the caret, which WebKit
 * then scrolled back to. The units are the rewrite's own (splitUnits), so
 * what is shown always ends where the layout of the rewrite does
 * (sentence-stream.ts).
 *
 * Each unit lands markTime() after the last - the moment its original is
 * marked (ui/moves.ts, the rewrite's reading cursor) - and a backlog of
 * more than BACKLOG lands at once. Display only, like StreamReveal (the
 * chat's typewriter): the received text stays the real one.
 */

/** Units waiting past which they all land together. */
const BACKLOG = 5;

/** A pause this long with a unit unfinished: it lands up to where it has
 *  got, at a comma or a space - for writing with no full stops. */
const IDLE_MS = 1000;

/** A sentence this long with no end yet lands up to its last comma or
 *  space too. */
const LONG_UNIT = 150;

/** Ends a sentence for certain, whatever follows: a full stop of a script
 *  that puts no space after it, an ellipsis. */
const CLOSED = /[。！？؟।…][”’"')）」』\]]*$/;

/** Where a unit may be cut when it has gone on too long or stopped. */
const SOFT_BREAK = /[，,、；;：:\s](?=[^，,、；;：:\s]*$)/;

/**
 * The ends of the units of `text` after `shown` that are complete - the
 * places what is on screen may stop at. A unit is complete once something
 * follows it, once the text is `done`, or, for the last: a sentence ended
 * by a line break, by a stop and a space, or by a stop that needs none; a
 * whole block only once the next begins. `idle`: nothing has come for a
 * while, so the last unit may land up to its last soft break.
 */
export function landingEnds(
  text: string,
  shown: number,
  done: boolean,
  idle: boolean,
): number[] {
  return landings(text, shown, done, idle).map((l) => l.end);
}

/** A place the text on screen may stop at; `cut` when it is partway into
 *  a unit (landingEnds' pause or long unit), not at its end. */
interface Landing {
  end: number;
  cut: boolean;
}

function landings(
  text: string,
  shown: number,
  done: boolean,
  idle: boolean,
): Landing[] {
  const units = splitUnits(text);
  const ends: Landing[] = [];
  let end = 0;
  units.forEach((unit, i) => {
    end += unit.length;
    const last = i === units.length - 1;
    if (end <= shown) return;
    // A pause after a stop that wants a space: the sentence is over.
    const stopped = idle && /[.!?;][”’"')）」』\]]*$/.test(unit);
    if (!last || done || stopped || lastComplete(unit)) {
      ends.push({ end, cut: false });
      return;
    }
    const start = end - unit.length;
    const kind = wholeBlockKind(unit.trim());
    if (kind === "code" || kind === "math") {
      // A fence grows a line at a time (a diagram a statement at a time),
      // its opening line with the first.
      const line = unit.lastIndexOf("\n");
      if (line > unit.indexOf("\n") && start + line + 1 > shown)
        ends.push({ end: start + line + 1, cut: true });
      return;
    }
    if (kind) return;
    const written = text.slice(Math.max(start, shown), end);
    if (idle || written.length >= LONG_UNIT) {
      const cut = written.search(SOFT_BREAK);
      if (cut > 0)
        ends.push({ end: Math.max(start, shown) + cut + 1, cut: true });
      // A few words with nowhere to cut them (a word replaced, a name):
      // all of them, once nothing more has come for a while.
      else if (idle) ends.push({ end, cut: true });
    }
  });
  return ends;
}

function lastComplete(unit: string): boolean {
  const kind = wholeBlockKind(unit.trim());
  // A picture or a rule is one line; a table or a footnote may have more
  // until a blank line ends it; a fence, until it is closed.
  if (kind === "picture" || kind === "rule") return /\n\s*$/.test(unit);
  if (kind === "code" || kind === "math") return fenceClosed(unit);
  if (kind) return /\n[ \t]*\n\s*$/.test(unit);
  if (/\n\s*$/.test(unit)) return true;
  if (/[.!?;；][”’"')）」』\]]*\s+$/.test(unit)) return true;
  return CLOSED.test(unit.trimEnd()) && unit.trimEnd() === unit;
}

function fenceClosed(unit: string): boolean {
  const lines = unit.trimEnd().split("\n");
  if (lines.length < 2 || !/\n\s*$/.test(unit)) return false;
  const open = /^\s*(`{3,}|~{3,}|\$\$)/.exec(lines[0])?.[1];
  return !!open && lines.at(-1)!.trim().startsWith(open);
}

export class UnitReveal {
  private received = "";
  private shown = 0;
  private done = false;
  private lastArrival = 0;
  private lastLanding = -Infinity;
  /** The complete units' ends after `shown`, read once per update. */
  private pending: Landing[] = [];
  private cut = false;
  private pendingFor = "";
  private pendingIdle = false;

  update(text: string, done: boolean, now: number) {
    if (text.length > this.received.length) this.lastArrival = now;
    this.received = text;
    this.done = done;
    this.shown = Math.min(this.shown, text.length);
  }

  /** Lands the next unit if its turn has come (an animation frame's
   *  timestamp). */
  tick(now: number) {
    const idle = !this.done && now - this.lastArrival >= IDLE_MS;
    const key = `${this.received.length}:${this.done}`;
    if (key !== this.pendingFor || idle !== this.pendingIdle) {
      this.pending = landings(this.received, this.shown, this.done, idle);
      this.pendingFor = key;
      this.pendingIdle = idle;
    }
    this.pending = this.pending.filter((l) => l.end > this.shown);
    if (this.pending.length === 0) return;
    const next =
      this.pending.length > BACKLOG
        ? this.pending.at(-1)!
        : now - this.lastLanding >= markTime()
          ? this.pending[0]
          : null;
    if (!next) return;
    this.shown = next.end;
    this.cut = next.cut;
    this.lastLanding = now;
  }

  /** What is on screen ends where a unit does - not partway into one, as
   *  a pause or a long sentence lands it - so all of it is complete. */
  get endsOnUnit(): boolean {
    return !this.cut;
  }

  /** What is on screen now. */
  get text(): string {
    return this.received.slice(0, this.shown);
  }

  /** Everything received so far is on screen. */
  get caughtUp(): boolean {
    return this.shown >= this.received.length;
  }
}
