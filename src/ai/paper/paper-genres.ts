import type { Strings } from "../../i18n/strings";
import type { Genre } from "../../platform/bindings/ai-paper";

/** The genres Research mode's picker offers after "auto", in its order;
 *  every one of Rust's `Genre::ALL` (ai/paper/genre.rs). */
export const PAPER_GENRES: readonly Genre[] = [
  "report",
  "analysis",
  "article",
  "thread",
  "brief",
  "paper",
  "review",
];

/** What the picker chose: a genre, or "auto" for the model to choose one
 *  from the topic. */
export type PaperGenreChoice = Genre | "auto";

/** A genre's name, as the picker and the card give it. */
export function genreLabel(t: Strings, genre: Genre): string {
  switch (genre) {
    case "paper":
      return t.paperGenrePaper;
    case "review":
      return t.paperGenreReview;
    case "report":
      return t.paperGenreReport;
    case "analysis":
      return t.paperGenreAnalysis;
    case "article":
      return t.paperGenreArticle;
    case "thread":
      return t.paperGenreThread;
    case "brief":
      return t.paperGenreBrief;
  }
}
