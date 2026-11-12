/** How many grips (a divider, a panel's edge) the pointer holds now: what
 *  is held moves with the pointer, not after it. */
let held = 0;

export function holdGrip(on: boolean): void {
  held = Math.max(0, held + (on ? 1 : -1));
}

export function gripHeld(): boolean {
  return held > 0;
}
