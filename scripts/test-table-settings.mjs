import assert from "node:assert/strict";
import {
  TABLE_SETTINGS_KEY,
  defaultTableSettings,
  loadTableSettings,
  saveTableSettings,
  sanitizeTableSettings,
} from "../src/lib/table-settings.ts";
const defaults = defaultTableSettings(
  ["track", "title", "album", "artist", "cover"],
  ["track", "title", "album"],
);
assert.equal(defaults.columnOrder[0], "album");
assert.equal(defaults.sortKey, "album");
assert.equal(defaults.sortOrder, "asc");
assert.deepEqual(loadTableSettings(defaults), defaults);
let content = null;
const storage = {
  getItem: (key) => {
    assert.equal(key, TABLE_SETTINGS_KEY);
    return content;
  },
  setItem: (key, value) => {
    assert.equal(key, TABLE_SETTINGS_KEY);
    content = value;
  },
};
const settings = {
  ...defaults,
  columnOrder: ["artist", "title", "album", "track", "cover"],
  visibleColumns: ["artist", "album"],
  columnWidths: { album: 360 },
  sortKey: "title",
  sortOrder: "desc",
  pageSize: 50,
};
assert.equal(saveTableSettings(settings, storage), true);
assert.deepEqual(loadTableSettings(defaults, storage), settings);
content = "broken JSON";
assert.deepEqual(loadTableSettings(defaults, storage), defaults);
const normalized = sanitizeTableSettings(
  {
    columnOrder: ["title", "title", "removed"],
    visibleColumns: ["removed"],
    columnWidths: { album: -1, artist: 999999, title: Infinity, removed: 80 },
    sortKey: "removed",
    sortOrder: "broken",
    pageSize: 17,
  },
  defaults,
);
assert.deepEqual(normalized.columnOrder, ["title", "album", "track", "artist", "cover"]);
assert.deepEqual(normalized.visibleColumns, defaults.visibleColumns);
assert.deepEqual(normalized.columnWidths, { album: 40, artist: 2000 });
assert.equal(normalized.sortKey, "album");
assert.equal(normalized.sortOrder, "asc");
assert.equal(normalized.pageSize, 1000);
assert.equal(sanitizeTableSettings({ sortKey: "cover" }, defaults).sortKey, "album");
assert.equal(sanitizeTableSettings({ sortKey: null }, defaults).sortKey, null);
for (const size of [50, 100, 250, 500, 1000])
  assert.equal(sanitizeTableSettings({ pageSize: size }, defaults).pageSize, size);
const blocked = {
  getItem: () => {
    throw Error("Denied");
  },
  setItem: () => {
    throw Error("Quota");
  },
};
assert.deepEqual(loadTableSettings(defaults, blocked), defaults);
assert.equal(saveTableSettings(settings, blocked), false);
assert.deepEqual(sanitizeTableSettings(null, defaults), defaults);
console.log(
  "PASS: fresh Album defaults, order/sort/width/visibility/page-size round-trip, duplicate/unknown/new columns, malformed JSON and blocked storage.",
);
