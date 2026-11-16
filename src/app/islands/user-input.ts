/** Whether the user has pointed or pressed a key since launch: focus that
 *  comes before (a webview's or an editor's own at start) picks no tab. */
let acted = false;

if (typeof window !== "undefined")
  for (const type of ["pointerdown", "keydown"])
    window.addEventListener(type, () => (acted = true), {
      capture: true,
      once: true,
    });

export const userHasActed = () => acted;
