# Persistent library table

The table now remembers dragged column order, column visibility, resized widths, sort column/direction and page size across reloads and reopening the app. Fresh settings place Album first after the fixed Actions column and sort albums A–Z. Within each album, songs follow disc number, track number and filename. A saved custom order or sort takes precedence over defaults.

Preferences are stored locally under `tagMaestro.table.v1`. Loading happens before saving is enabled, so initial defaults cannot overwrite an existing layout during hydration. Unknown/duplicate column keys and invalid values are discarded; newly added columns are appended. Invalid JSON falls back to usable defaults. Unavailable browser storage shows a warning rather than breaking the table.

Browser storage belongs to the exact origin (protocol, host and port). Keep using the same app URL; `localhost` and `127.0.0.1`, or different ports, have separate preferences. Clearing site data or using a private browsing session can remove preferences. No music files or credentials are stored in these settings.

Regression check: `node scripts/test-table-settings.mjs` (Node with TypeScript type-stripping support, e.g. Node 22.18+). Covers defaults, round-trip persistence, malformed settings, duplicate/retired/new columns, widths, visibility, page size and blocked storage.
