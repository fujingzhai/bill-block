# Bill Block

Bill Block embeds a lightweight expense tracker directly inside SiYuan documents, for jotting down and reviewing spending right in your daily notes, monthly reviews, project budgets, or personal dashboard.

It is not a standalone finance app, and it is not a replacement for database views. It focuses on a narrower workflow: putting an editable, long-lived, multi-device bill block inside the note you are already writing, without creating a database or leaving the document. Every bill block shares one ledger, so adding, editing, or deleting an entry in any block updates the others instantly.

## One Block, Multiple Views

Insert from the slash menu `/记账块` (also matches `记账`, `账单`, `jizhang`, `expense`, `ledger`) or the top-bar ¥ menu's "Insert Bill Block". Add as many as you like in any document. Each block carries four views, switched in place without interfering with each other:

- **Flow**: a quick-entry row (amount → category → project → note → date → Enter) above a date-grouped, reverse-chronological stream of all transactions, with inline edit and delete. Flow is the only view that may show a scrollbar — its height matches the Week view and the list scrolls inside the block instead of stretching it.
- **Week**: a Monday–Sunday seven-day board shaded by daily spending; click a day for details, click a cell's "+" or double-click an entry to record or edit in place. A category bar chart and a trend line chart sit below.
- **Month**: a full-month calendar board with the same logic as Week; each cell shows up to three entries directly, collapsing the rest into "+N".
- **Stats**: a horizontal category bar chart (with share, sortable by default / descending / ascending) and a trend line chart (by day / week / month / year, custom date range, multiple category series at once).

## Highlights

- One ledger, synced live across multiple blocks and views, with no SiYuan database required.
- New ledgers start with no preset categories, so each user can build their own category system from scratch.
- The ledger lives in a standalone workspace file and syncs across devices via SiYuan's official cloud sync.
- Flow, Week, and Month views all carry a quick-entry row; amount and project are required, category / note / date are optional.
- Week / Month can pin a specific week or month as the block's default (stored in block attributes, restored on reload); a center anchor button jumps back after browsing other periods.
- The default-week picker supports typing "year + week number" or picking from a calendar, with the week's exact date range annotated inline.
- Week / Month cell entries show the project name by default; when a note exists, hovering the entry reveals it in a tooltip, and nothing shows when there is no note.
- Stats trend chart: total spending uses a neutral grey line while each category keeps its own color; with multiple lines, hovering a point highlights that line and fades the rest, and an enlarged hit area makes overlapping lines easy to target.
- The category bar chart shows every category by default; enable "Hide categories with no spending" in the category manager to show only categories with spending in the current period.
- Two-level category management: add, rename, recolor, drag-reorder, and delete (deleted categories' entries fall back to "Uncategorized"); a 10-color palette, a color picker, and `#RRGGBB` hex input are all available.
- A global hotkey `Option+Command+B` (configurable in SiYuan settings) opens "Add bill" anywhere; the top-bar ¥ menu can also add one quickly.
- Each view can export its current state to a PNG from the top-right corner; transient controls are hidden during export, and Desktop is preferred as the save location.
- Use `Cmd/Ctrl+Z` to undo the previous ledger operation (up to 50 steps).

## Interaction Details

- The quick-entry row and inline forms save on Enter once amount and project are valid; press `Esc` or click Cancel to discard the current entry.
- The default-week, default-month, and category-manager buttons all close their popover when their own button is clicked again.
- While editing inline, clicking outside the block (including across the iframe onto the SiYuan UI) or on blank space inside the block exits editing and restores the row.
- Week / Month cells are shaded by daily spending, with today and the selected day emphasized by an outline.
- Amounts use locale thousands separators and tabular figures for alignment.

## Data

The ledger is stored in the SiYuan workspace at:

`/data/storage/bill-block/data.json`

Before each write the previous good copy is backed up to `data.json.bak` in the same folder; if the file is corrupted or fails to load, writes are blocked to avoid overwriting existing data. Open blocks stay in sync via BroadcastChannel, and cross-device sync relies on SiYuan's official cloud sync.

Each block also stores its own default week / month in block attributes, restored next time it opens.

## Good Fits

- Casual expense logging in daily, monthly, and yearly reviews.
- Budget and spending records inside project documents.
- One-off expense lists for trips, renovations, or events.
- A spending overview in a personal dashboard.
- Any note that benefits from keeping the ledger inline, without opening a separate finance app.

## License

MIT

---

## Statement

This plugin was made entirely through vibe coding. The tools and models used were roughly:

- Codex (GPT 5.5): 40%
- Claude Code (Fable 5): 20%
- Claude Code (Opus 4.8): 20%
- Antigravity (Gemini 3.5 Flash): 20%

Please use it at your own discretion.
