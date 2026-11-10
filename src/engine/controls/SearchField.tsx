import { forwardRef, type InputHTMLAttributes } from "react";
import { SearchIcon } from "./icons";
import "./search-field.css";

/**
 * The one search box: a magnifier and a field in the control's rounded
 * rectangle, its ring drawn inside the border on focus. Every list that
 * filters as you type uses it (the Search page, plugins).
 */
export const SearchField = forwardRef<
  HTMLInputElement,
  Omit<InputHTMLAttributes<HTMLInputElement>, "type">
>(function SearchField({ className, ...input }, ref) {
  return (
    <div className={className ? `tx-search ${className}` : "tx-search"}>
      <SearchIcon className="tx-search-icon" />
      <input
        ref={ref}
        type="search"
        className="tx-search-input"
        spellCheck={false}
        autoComplete="off"
        {...input}
      />
    </div>
  );
});
