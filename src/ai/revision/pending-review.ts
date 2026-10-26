import { useEffect, useMemo, useRef, useState } from "react";
import { nextFocusAfterChange, orderForReview } from "./pending-edit-focus";
import {
  reviewChanges,
  sentenceTake,
  type PendingPreview,
} from "./pending-edit-plugin";

/** Going through the proposals one by one: the review bar's stops and count,
 *  and Quick Ask's per-proposal pointer. */

/** One stop of the review bar: a changed sentence, or a whole proposal
 *  that isn't shown sentence by sentence (`index` -1). */
export interface ReviewStop {
  callId: string;
  index: number;
  from: number;
}

/** What the review bar and the margin go through, top to bottom: decidable
 *  previews, and streaming rewrites whose completed changes can be looked at. */
export function reviewedPreviews(previews: PendingPreview[]): PendingPreview[] {
  return previews
    .filter((p) => !p.streaming || p.streamChanges)
    .sort((a, b) => a.from - b.from);
}

/** Every changed sentence of a proposal shown that way, or the proposal
 *  itself otherwise, top to bottom. */
export function reviewStopsOf(reviewed: PendingPreview[]): ReviewStop[] {
  return reviewed
    .flatMap((p) => {
      const changes = reviewChanges(p);
      return changes
        ? changes.map((c, index) => ({ callId: p.callId, index, from: c.from }))
        : [{ callId: p.callId, index: -1, from: p.from }];
    })
    .sort((a, b) => a.from - b.from);
}

/** How much an Accept-everything would take: changed sentences (a whole
 *  proposal counting as one) taken of all of them. */
export function reviewCountOf(reviewed: PendingPreview[]): {
  taken: number;
  total: number;
} {
  let taken = 0;
  let total = 0;
  for (const p of reviewed) {
    const take = p.streaming
      ? (p.streamChanges ?? []).map(() => true)
      : sentenceTake(p);
    if (take) {
      total += take.length;
      taken += take.filter(Boolean).length;
    } else {
      total += 1;
      taken += 1;
    }
  }
  return { taken, total };
}

const keyOf = (stop: ReviewStop) => `${stop.callId}:${stop.index}`;

/** `index` moved by `delta` around `length` items; from no position, the
 *  first one - or, with `fromEnd`, the last one going back. */
function wrap(
  length: number,
  index: number,
  delta: 1 | -1,
  fromEnd: boolean,
): number {
  if (index === -1) return fromEnd && delta === -1 ? length - 1 : 0;
  return (index + delta + length) % length;
}

interface Pointers {
  /** Quick Ask's proposal, by call id. */
  focused: string | null;
  /** The review bar's stop, by `callId:index`. */
  stop: string | null;
}

export function useReviewNavigation(previews: PendingPreview[]) {
  const derived = useMemo(() => {
    const reviewed = reviewedPreviews(previews);
    return {
      decidable: orderForReview(previews),
      reviewed,
      reviewStops: reviewStopsOf(reviewed),
      reviewCount: reviewCountOf(reviewed),
      reviewStreaming: reviewed.some((p) => p.streaming),
    };
  }, [previews]);
  const [pointers, setPointers] = useState<Pointers>({
    focused: null,
    stop: null,
  });
  // Each pointer keeps its place when the previews change, rather than going
  // back to the start.
  const last = useRef({ order: [] as string[], stops: [] as string[] });
  useEffect(() => {
    const order = derived.decidable.map((p) => p.callId);
    const stops = derived.reviewStops.map(keyOf);
    setPointers((prev) => ({
      focused: nextFocusAfterChange(last.current.order, prev.focused, order),
      stop:
        prev.stop === null
          ? null
          : nextFocusAfterChange(last.current.stops, prev.stop, stops),
    }));
    last.current = { order, stops };
  }, [derived]);

  return useMemo(() => {
    const { decidable, reviewStops } = derived;
    const focusIndex = pointers.focused
      ? decidable.findIndex((p) => p.callId === pointers.focused)
      : -1;
    const stopIndex = pointers.stop
      ? reviewStops.findIndex((s) => keyOf(s) === pointers.stop)
      : -1;
    const pointAt = (stop: ReviewStop) =>
      setPointers({ focused: stop.callId, stop: keyOf(stop) });
    return {
      ...derived,
      focusedCallId: pointers.focused,
      focusIndex,
      focusedPreview: focusIndex >= 0 ? decidable[focusIndex] : null,
      stopIndex,
      focusedStop: stopIndex >= 0 ? reviewStops[stopIndex] : null,
      /** Moves the review bar's pointer and returns where it now is. */
      stepReview(delta: 1 | -1): ReviewStop | null {
        if (reviewStops.length === 0) return null;
        const stop =
          reviewStops[wrap(reviewStops.length, stopIndex, delta, true)];
        pointAt(stop);
        return stop;
      },
      /** Points the review bar at a sentence (index -1: the proposal's
       *  first stop) - a card's sentence or "Show in text" was clicked. */
      pointReview(callId: string, index: number): ReviewStop | null {
        const stop =
          reviewStops.find(
            (s) => s.callId === callId && (index < 0 || s.index === index),
          ) ?? null;
        if (stop) pointAt(stop);
        return stop;
      },
      /** Moves Quick Ask's pointer by `delta`, wrapping, and returns what it
       *  now points at. */
      step(delta: 1 | -1): PendingPreview | null {
        if (decidable.length === 0) return null;
        const preview =
          decidable[wrap(decidable.length, focusIndex, delta, false)];
        setPointers((prev) => ({ ...prev, focused: preview.callId }));
        return preview;
      },
    };
  }, [derived, pointers]);
}
