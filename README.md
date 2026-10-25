# Urdu Writer

A static Urdu writing site built with HTML, CSS, and browser JavaScript. It has no package manager or build step.

## Run locally

Open the project folder in VS Code and use a static server such as Live Server. Alternatively, if Python is installed, open PowerShell in this folder and run:

```powershell
py -m http.server 8000
```

Then visit `http://localhost:8000`. A local server is preferable to opening files directly because browser storage, file access, and external-service requests can behave differently for `file:` URLs.

## Project layout

- Root HTML pages are the site's entry points: home, editor, feedback, help, and policy pages.
- `assets/css/` contains shared home and editor styles.
- `assets/js/` contains the site's browser-side behavior and optional feedback configuration.
- `assets/Media/` contains icons and other static media used by the pages.
- `database/feedback.sql` creates the Supabase feedback table and its row-level security policy.
- `docs/database-setup.md` explains how to configure and test Supabase feedback.

## Current service limits

- Documents are saved in local browser storage; there is no account-based cloud sync.
- Urdu typing follows the pictured English-key layout, with an interactive keyboard map and typing test in the writing guide.
- The editor provides built-in Urdu word suggestions while typing. Use the arrow keys and Enter/Tab, or select a suggestion; typed text and suggestions stay in the browser.
- The editor includes print preview, repeating print headers and footers, Urdu-to-Roman-Urdu conversion, table editing controls, and picture sizing and wrapping controls. In the Insert tab, choose rows and columns from the Table hover grid or enter a custom size; the default custom table is five-by-five and fills the page width. Tables are inserted directly for immediate editing with black borders. Drag row dividers to resize only that row and column dividers to adjust the adjacent columns; the row/column add buttons appear only when hovering at a divider's outer edge. Adding a row keeps the neighboring row's height and existing row sizes; adding a column preserves other column widths and splits the adjacent column's width to keep the table within its current width. Drag across table cells to select a rectangular cell range; partial ranges remain editable, while complete rows or columns show a six-dot handle and can be reordered. During reordering, a destination preview shows the insertion position, including the table's top/bottom edges for rows and left/right edges for columns. Double-left-click a table to open its contextual Table Layout tab; selecting another tab hides it. The contextual tab includes table design presets, a Home-style border-color palette, and icon buttons for deleting the current row, column, or table. The Urdu on-screen keyboard includes common Arabic/Urdu diacritics.
- Login, sign-up, and Google sign-in are interface-only.
- Feedback is not sent or saved until Supabase is configured as described in the database guide.

## Checks

JavaScript syntax can be checked from PowerShell with:

```powershell
Get-ChildItem -Recurse -File assets\js\*.js | ForEach-Object { node --check $_.FullName }
```
