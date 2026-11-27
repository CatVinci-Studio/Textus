/** What Android's app offers the page as `TextusAndroid`
 *  (src-tauri/android/MainActivity.kt). */
interface AndroidBridge {
  /** The status bar's, the navigation bar's and the cutout's room, in CSS
   *  px. */
  top(): number;
  bottom(): number;
  left(): number;
  right(): number;
  /** The page's Appearance, for the bars' icons: light, dark or system. */
  setAppearance(mode: string): void;
  /** Keeps the back gesture off the left edge while a swipe from there opens
   *  the sidebar. */
  setEdgeSwipe(on: boolean): void;
  /** The system's font size, as a factor (1 by default, up to 2): Interface
   *  Size follows it (theme/system-text-size.ts). */
  fontScale(): number;
}

export function androidBridge(): AndroidBridge | null {
  return (window as { TextusAndroid?: AndroidBridge }).TextusAndroid ?? null;
}
