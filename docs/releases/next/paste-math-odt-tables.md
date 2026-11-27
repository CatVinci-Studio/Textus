### Fixed

- Formulas in an answer copied from an AI chat (Gemini, ChatGPT) paste as formulas in the rich view: `$$…$$` on its own line becomes a math block and `$…$` in a sentence inline maths, rather than escaped text (#826). Prices such as "$5 and $10" stay text.
- Tables exported to ODT have their cell lines again; LibreOffice showed them without borders (#827).
