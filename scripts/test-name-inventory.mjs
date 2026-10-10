import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, stat, symlink, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
const { NameInventory } = createRequire(import.meta.url)("../desktop/name-inventory.cjs");
const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "tag-maestro-names-")));
const library = path.join(root, "Library");
await mkdir(library);
await mkdir(path.join(library, "Album Old"));
await mkdir(path.join(library, "Album Old", "Disc 1"));
const contents = Buffer.from("opaque ZIP fixture: never extracted or read by the inventory");
await writeFile(path.join(library, "Album Old", "Music.ZIP"), contents);
await writeFile(path.join(library, "Music.zip"), contents);
for (const name of [
  "First Album.rar",
  "Second Album.RAR",
  "Third Album.rar",
  "Archive.7z",
  "Album.tar.gz",
])
  await writeFile(path.join(library, name), contents);
await writeFile(path.join(library, "ignore.mp3"), Buffer.from("not parsed"));
const outside = path.join(root, "outside");
await mkdir(outside);
try {
  await symlink(outside, path.join(library, "link"), "dir");
} catch (error) {
  if (!["EPERM", "EACCES"].includes(error.code)) throw error;
}
const engine = new NameInventory();
const job = await engine.start(library);
await engine.jobs.get(job.id).task;
const listed = engine.poll(job.id);
assert.equal(listed.done, true);
assert.equal(listed.entries.length, 9);
assert.equal(
  listed.entries.filter((entry) => entry.kind === "archive" && /\.rar$/i.test(entry.name)).length,
  3,
);
assert.deepEqual(listed.ignored, [{ extension: ".mp3", count: 1 }]);
assert.equal(
  listed.entries.some((entry) => entry.name === "ignore.mp3" || entry.name === "link"),
  false,
);
const zip = listed.entries.find((entry) => entry.relative === "Music.zip");
const folder = listed.entries.find((entry) => entry.relative === "Album Old");
const nested = listed.entries.find((entry) => entry.relative === "Album Old/Disc 1");
assert.match(
  (await engine.rename(job.id, [{ id: zip.id, name: "../escape.zip" }])).error,
  /Invalid/,
);
assert.match(
  (await engine.rename(job.id, [{ id: "not-granted", name: "X.zip" }])).error,
  /Invalid/,
);
assert.match((await engine.rename(job.id, [{ id: zip.id, name: "X.mp3" }])).error, /extension/);
assert.match(
  (
    await engine.rename(job.id, [
      { id: folder.id, name: "Album New" },
      { id: nested.id, name: "Disc Two" },
    ])
  ).error,
  /parent/,
);
await writeFile(path.join(library, "existing.zip"), contents);
const initialConflict = await engine.rename(job.id, [{ id: zip.id, name: "existing.zip" }]);
assert.equal(initialConflict.conflicts.length, 1);
assert.equal(initialConflict.conflicts[0].name, "existing.zip");
assert.equal(initialConflict.conflicts[0].canOverwrite, true);
assert.equal(initialConflict.renamed.length, 0);
const before = await stat(path.join(library, "Music.zip"));
assert.equal(
  (await engine.rename(job.id, [{ id: zip.id, name: "Album (2001).zip" }])).renamed.length,
  1,
);
const after = await stat(path.join(library, "Album (2001).zip"));
assert.equal(after.ino, before.ino);
assert.equal(after.mtimeMs, before.mtimeMs);
assert.deepEqual(await readFile(path.join(library, "Album (2001).zip")), contents);
for (const name of [
  "First Album.rar",
  "Second Album.RAR",
  "Third Album.rar",
  "Archive.7z",
  "Album.tar.gz",
]) {
  const archive = listed.entries.find((entry) => entry.name === name);
  const before = await stat(path.join(library, name));
  assert.match(
    (await engine.rename(job.id, [{ id: archive.id, name: "Changed.zip" }])).error,
    /extension/,
  );
  const target = "Renamed " + name;
  assert.equal((await engine.rename(job.id, [{ id: archive.id, name: target }])).renamed.length, 1);
  const after = await stat(path.join(library, target));
  assert.equal(after.ino, before.ino);
  assert.equal(after.mtimeMs, before.mtimeMs);
  assert.deepEqual(await readFile(path.join(library, target)), contents);
}
assert.equal(
  (await engine.rename(job.id, [{ id: folder.id, name: "Album New" }])).renamed.length,
  1,
);
assert.equal(
  engine.poll(job.id).entries.find((entry) => entry.id === nested.id).relative,
  "Album New/Disc 1",
);
assert.equal(
  (await engine.rename(job.id, [{ id: nested.id, name: "Disc Two" }])).renamed.length,
  1,
);
await engine.release(job.id);
assert.throws(() => engine.poll(job.id), /Invalid/);
// A 5,000-album synthetic names-only listing; music bytes are never opened.
const large = path.join(root, "Large");
await mkdir(large);
for (let index = 0; index < 5000; index += 50)
  await Promise.all(
    Array.from({ length: 50 }, (_, offset) => mkdir(path.join(large, `Album ${index + offset}`))),
  );
const started = performance.now(),
  largeJob = await engine.start(large);
await engine.jobs.get(largeJob.id).task;
let count = 0;
for (;;) {
  const result = engine.poll(largeJob.id, count);
  count += result.entries.length;
  if (count >= result.total) break;
}
assert.equal(count, 5000);
await engine.release(largeJob.id);
console.log(
  `PASS: ZIP/folder listing, literal archive extensions, scoped IDs, collisions/traversal/parent-child safety, original bytes/inode/mtime preserved; 5,000 local fixture folders listed in ${Math.round(performance.now() - started)} ms. No user files touched.`,
);
