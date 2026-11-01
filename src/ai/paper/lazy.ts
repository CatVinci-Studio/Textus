import { lazyModule } from "../../lazy/lazy-module";
import { lazyComponent } from "../../lazy/lazy-component";

/** The paper agent's UI: loaded the first time a paper is started or a
 *  paper card is drawn, never at startup. */
const paperUi = lazyModule("paper", () => import("./paper-ui"));

export const PaperCard = lazyComponent(paperUi, (m) => m.PaperCard);
export const PaperLength = lazyComponent(paperUi, (m) => m.PaperLength);
