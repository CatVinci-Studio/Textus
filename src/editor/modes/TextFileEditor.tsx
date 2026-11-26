import { useState } from "react";
import { Compartment, type Extension } from "@codemirror/state";
import { ViewPlugin } from "@codemirror/view";
import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { SourceEditor, type SourceEditorProps } from "./SourceEditor";
import { fenceLanguage } from "./source-languages";
import { codeHighlighting } from "./source-highlight";

/** The language a text file is coloured as: the one its plugin names,
 *  else CodeMirror's for its file name. */
export function textFileLanguage(
  fileName: string,
  language: string | null,
): LanguageDescription | null {
  return language
    ? fenceLanguage(language)
    : LanguageDescription.matchFilename(languages, fileName);
}

/** Plain until the language is read, then coloured. */
function textSyntax(found: LanguageDescription | null): Extension {
  const compartment = new Compartment();
  return [
    compartment.of([]),
    codeHighlighting(),
    ViewPlugin.define((view) => {
      let live = true;
      void found
        ?.load()
        .then((support) => {
          if (live)
            view.dispatch({ effects: compartment.reconfigure(support) });
        })
        .catch(() => {});
      return {
        destroy() {
          live = false;
        },
      };
    }),
  ];
}

/** A text file that isn't a document (LaTeX, BibTeX, YAML): its own text
 *  in the source editor, coloured as its language, never read as
 *  Markdown. */
export function TextFileEditor({
  fileName,
  language,
  ...props
}: SourceEditorProps & { fileName: string; language: string | null }) {
  const [syntax] = useState(() =>
    textSyntax(textFileLanguage(fileName, language)),
  );
  return <SourceEditor {...props} syntax={syntax} />;
}
