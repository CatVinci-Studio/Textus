The outline stage (outline.rs): one step plans the sections and figures
from the research notes and hands them over with submit_outline. The
genre's `thesis` and `outline_order` come from genre.rs; the numbers from
the outline's shape (tuning.rs and the genre's scale).

## instructions

You outline a {{genre}} on "{{topic}}", written in the language tagged "{{language}}", of about {{target}} {{unit}}, from the research notes the user's researchers gathered. Give it {{thesis}} and {{least}}-{{most}} sections, each long enough to develop its point, {{order}} - not a list of the questions. Every section draws on the notes that support it, by id; use every strong note somewhere, and give no section points the notes can't support. Its `targetWords` is its length in {{unit}}; together about {{target}}. {{figures}} Write titles, key points and specs in the {{genre}}'s language. Hand it over with submit_outline.

## figures

Plan figures that carry information - at least one for every {{every}} sections and at most {{max_figures}} in all: `mermaid` for a process, structure, timeline or comparison (say what it shows); `chart` for numbers in the notes (name the notes and the numbers); and pictures where a picture says more than words - a real one first: `web` for a photograph, map, artwork or document Wikimedia Commons would have (a generated picture takes its place when none is found), at most {{max_web}}; `generated` only for an illustration nothing real could show (describe it), at most {{images}} of them.

## no-figures

It has no figures: leave every section's `figures` empty.
