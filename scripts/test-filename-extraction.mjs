import assert from "node:assert/strict";
import {
  DEFAULT_FILENAME_EXTRACTION,
  extractFilenameText,
  filenameExtractionError,
} from "../src/lib/filename-extraction.ts";
import { parseFilenameTemplate } from "../src/lib/tag-converter.ts";

const sample = "Aayusu Nooru - 02 - Brahmadevan.mp3";
const extract = (filename, changes = {}) =>
  extractFilenameText(filename, { ...DEFAULT_FILENAME_EXTRACTION, ...changes });
assert.equal(extract(sample), "Aayusu Nooru");
assert.equal(extract(sample, { mode: "after-separator" }), "02 - Brahmadevan");
assert.equal(extract(sample, { position: 2 }), "Aayusu Nooru - 02");
assert.equal(extract(sample, { mode: "after-separator", fromEnd: true }), "Brahmadevan");
assert.equal(extract(sample, { mode: "part", position: 2 }), "02");
assert.equal(extract(sample, { mode: "part", position: 3 }), "Brahmadevan");
assert.equal(extract(sample, { mode: "part", fromEnd: true }), "Brahmadevan");
assert.equal(extract(sample, { mode: "part", position: 2, fromEnd: true }), "02");
assert.equal(extract("Album::02::Song.flac", { separator: "::" }), "Album");
assert.equal(extract("A.R. Rahman - 02 - Song.flac"), "A.R. Rahman");
for (const separator of ["[", "|", "+", ".", "(", "_", "#", "—"]) {
  assert.equal(extract(`Album${separator}02${separator}Song.mp3`, { separator }), "Album");
}
assert.equal(extract("I-Love You - 02 - Song.mp3", { separator: " - " }), "I-Love You");
assert.equal(extract(sample, { mode: "before-number" }), "Aayusu Nooru");
assert.equal(extract(sample, { mode: "after-number" }), "Brahmadevan");
assert.equal(
  extract(sample, { mode: "before-number", trimNumberSeparators: false }),
  "Aayusu Nooru -",
);
assert.equal(
  extract("Film 1986 - 02 - Song.mp3", { mode: "before-number", position: 2 }),
  "Film 1986",
);
assert.equal(extract("Film 1986 - 02 - Song.mp3", { mode: "after-number", fromEnd: true }), "Song");
assert.equal(extract("ஆயுசு நூறு - ௦௨ - பாடல்.mp3", { mode: "before-number" }), "ஆயுசு நூறு");
assert.equal(extract(sample, { mode: "characters", start: 1, end: 12 }), "Aayusu Nooru");
assert.equal(extract(sample, { mode: "characters", start: 21 }), "Brahmadevan");
assert.equal(extract("👩‍🎤 Singer.mp3", { mode: "characters", start: 1, end: 1 }), "👩‍🎤");
assert.equal(extract("ஆயுசு நூறு.mp3", { mode: "characters", start: 1, end: 1 }), "ஆ");
assert.equal(extract("  Album  - Song.mp3", { trim: false }), "  Album  ");
assert.equal(extract("Album--Song.mp3", { mode: "part", position: 2 }), null);
assert.equal(extract("Album--Song.mp3", { mode: "part", position: 3 }), "Song");
for (const rule of [
  { separator: "" },
  { position: 0 },
  { position: 1.5 },
  { position: Infinity },
  { mode: "characters", start: 0 },
  { mode: "characters", start: 5, end: 4 },
]) {
  assert.ok(filenameExtractionError({ ...DEFAULT_FILENAME_EXTRACTION, ...rule }));
  assert.equal(extract(sample, rule), null);
}
assert.equal(extract("Unmatched.mp3"), null);
assert.equal(
  extract("No number.mp3", { mode: "before-number" }),
  null,
  "Extension digits must not become number markers",
);
assert.equal(extract(sample, { position: 10 }), null);
assert.equal(extract(sample, { mode: "characters", start: 500 }), null);
assert.equal(
  extract(" - 02 - Song.mp3"),
  null,
  "Empty extraction must never clear an existing tag",
);
const file = { file: { name: sample }, meta: { path: sample } };
assert.deepEqual(parseFilenameTemplate(file, "%album% - %track% - %title%"), {
  album: "Aayusu Nooru",
  track: "02",
  title: "Brahmadevan",
});
assert.deepEqual(parseFilenameTemplate(file, "%album% - %dummy% - %dummy%"), {
  album: "Aayusu Nooru",
});
console.log(
  "PASS: filename extraction, custom symbols, number occurrences, visible character positions, safe skips and existing patterns.",
);
