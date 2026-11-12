import { getUiState, setUiState } from "../../storage/ui-state";

/** Web search starts as the composer's button was last left: on once
 *  pressed, across conversations and windows, until pressed again. */
export function webSearchOn(): boolean {
  return getUiState("webSearch") === true;
}

export function rememberWebSearch(on: boolean): void {
  setUiState("webSearch", on);
}
