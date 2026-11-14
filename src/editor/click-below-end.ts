import { Plugin, TextSelection } from "@milkdown/kit/prose/state";
import { $prose } from "@milkdown/kit/utils";

/**
 * A click or tap below the last block when that block takes no text of
 * its own at its end (a table, a code block's frame, a picture): a new
 * paragraph there with the caret in it, as editors give one, instead of
 * the caret going into the block's last cell.
 */
export const clickBelowEnd = $prose(
  () =>
    new Plugin({
      props: {
        handleClick(view, _pos, event) {
          if (!view.editable) return false;
          const { doc, schema } = view.state;
          const last = doc.lastChild;
          if (!last || last.isTextblock) return false;
          const dom = view.nodeDOM(doc.content.size - last.nodeSize);
          if (!(dom instanceof HTMLElement)) return false;
          if (event.clientY <= dom.getBoundingClientRect().bottom) return false;
          const paragraph = schema.nodes.paragraph?.create();
          if (!paragraph) return false;
          const tr = view.state.tr.insert(doc.content.size, paragraph);
          tr.setSelection(
            TextSelection.create(tr.doc, tr.doc.content.size - 1),
          );
          view.dispatch(tr.scrollIntoView());
          return true;
        },
      },
    }),
);
