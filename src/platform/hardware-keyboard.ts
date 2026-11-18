/** Whether a hardware keyboard is connected to a phone or tablet, as the
 *  iOS app says (`textus-hardware-keyboard`): no on-screen keyboard comes
 *  up for one, so the page can't tell. */
export function hardwareKeyboard(): boolean {
  return (
    (window as { textusHardwareKeyboard?: boolean }).textusHardwareKeyboard ===
    true
  );
}
