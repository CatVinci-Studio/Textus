import { createContext } from "react";

/** Whether the islands show rows of tabs (not in Zen, with the tab bar off
 *  or a lone tab under the title): a page with a + of its own keeps it
 *  only while there is no row's + to use. */
export const TabRowsShown = createContext(true);
