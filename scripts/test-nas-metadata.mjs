import assert from "node:assert/strict";
import { createServer } from "vite";
import { mkdtemp, mkdir, realpath, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
const root = await mkdtemp(path.join(os.tmpdir(), "tag-maestro-fast-tags-"));
const server = await createServer({
  configFile: false,
  cacheDir: path.join(root, "cache"),
  server: { middlewareMode: true, hmr: false, ws: false },
  optimizeDeps: { noDiscovery: true },
});
try {
  const { readMp3 } = await server.ssrLoadModule("/src/lib/mp3.ts");
  const { replaceName, archiveBaseName, originalArchiveSuffix } = await server.ssrLoadModule(
    "/src/lib/library-names.ts",
  );
  assert.equal(replaceName("Album.[Old].old", "[old]", "$&", false), "Album.$&.old");
  assert.equal(replaceName("A.a.A", ".", "?", false), "A?a?A");
  const { folderName } = createRequire(import.meta.url)("../desktop/folder-renames.cjs");
  const { NameInventory } = createRequire(import.meta.url)("../desktop/name-inventory.cjs");
  const album = "Bheema (Five Star Audio) [2008-WAV]";
  const originalName = album + "  [Desihires.com]";
  assert.equal(folderName(album), album, "brackets and parentheses are valid");
  assert.throws(() => folderName(album + " "), /Remove whitespace at the beginning or end/);
  assert.throws(() => folderName(album + " "), /Whitespace at the end/);
  assert.throws(() => folderName(" " + album), /Whitespace at the beginning/);
  assert.throws(() => folderName("bad/name"), /unsupported characters: "\/"/);
  assert.throws(() => folderName("bad\u0000name"), /unsupported characters: "\\u0000"/);
  assert.throws(() => folderName(""), /new name is empty/);
  assert.throws(() => folderName("CON"), /reserved by Windows/);
  assert.throws(() => folderName("bad."), /cannot end with a period/);
  for (const matchCase of [false, true]) {
    assert.equal(
      replaceName(album + "[Desihires.com]", " [Desihires.com]", "", matchCase),
      album + "[Desihires.com]",
      "the space in Find is required for a match",
    );
    assert.equal(
      replaceName(album + " [Desihires.com]", "  [Desihires.com]", "", matchCase),
      album + " [Desihires.com]",
      "two spaces in Find must not match one space",
    );
    assert.equal(replaceName(originalName, "  [Desihires.com]", "", matchCase), album);
    assert.equal(replaceName(originalName, " [Desihires.com]", "", matchCase), album);
    assert.equal(replaceName(originalName, "[Desihires.com]", "", matchCase), album);
    assert.equal(replaceName("[Desihires.com]  " + album, "[Desihires.com]", "", matchCase), album);
    assert.equal(replaceName(" Unmatched ", "[Desihires.com]", "", matchCase), " Unmatched ");
    assert.equal(replaceName(" Unmatched ", "", "", matchCase), " Unmatched ");
  }
  const library = path.join(await realpath(root), "Rename Library");
  await mkdir(library);
  await mkdir(path.join(library, originalName));
  const before = await stat(path.join(library, originalName));
  const engine = new NameInventory();
  const job = await engine.start(library);
  await engine.jobs.get(job.id).task;
  const entry = engine.poll(job.id).entries[0];
  const rejected = await engine.rename(job.id, [{ id: entry.id, name: album + " " }]);
  assert.ok(
    rejected.error.includes(JSON.stringify(entry.relative)),
    "error identifies the original folder",
  );
  assert.match(rejected.error, /Whitespace at the end/);
  assert.equal(
    engine.pollSaveProgress(job.id).error,
    rejected.error,
    "the cause remains available after saving stops",
  );
  const rename = await engine.rename(job.id, [
    { id: entry.id, name: replaceName(entry.name, " [Desihires.com]", "", false) },
  ]);
  assert.equal(rename.error, undefined);
  assert.equal(rename.renamed.length, 1);
  assert.equal((await stat(path.join(library, album))).ino, before.ino);
  await engine.release(job.id);
  assert.equal(archiveBaseName({ kind: "archive", name: "Album.ZIP" }), "Album");
  for (const [name, stem, suffix] of [
    ["Album.RAR", "Album", ".RAR"],
    ["Album.7z", "Album", ".7z"],
    ["Album.tar.gz", "Album", ".tar.gz"],
  ]) {
    assert.equal(archiveBaseName({ kind: "archive", name }), stem);
    assert.equal(originalArchiveSuffix({ kind: "archive", name }), suffix);
  }
  const header = new Uint8Array(44),
    view = new DataView(header.buffer),
    text = new TextEncoder();
  const dataSize = 20 * 1024 * 1024;
  header.set(text.encode("RIFF"));
  view.setUint32(4, dataSize + 36, true);
  header.set(text.encode("WAVEfmt "), 8);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, 48000, true);
  view.setUint32(28, 192000, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  header.set(text.encode("data"), 36);
  view.setUint32(40, dataSize, true);
  let bytesRead = 0;
  class RangeFile extends File {
    async arrayBuffer() {
      throw new Error("Full-file transfer is forbidden in fast loading");
    }
    slice(start, end, type) {
      const result = super.slice(start, end, type);
      const original = result.arrayBuffer.bind(result);
      result.arrayBuffer = async () => {
        bytesRead += result.size;
        return original();
      };
      return result;
    }
  }
  const source = new RangeFile([header, new Uint8Array(dataSize)], "large.wav", {
    type: "audio/wav",
  });
  const row = await readMp3(source, "NAS/Album/large.wav", true, false);
  assert.equal(row.meta.length, "1:49");
  assert.equal(row.meta.frequency, "48000 Hz");
  assert.equal(row.meta.mode, "Stereo");
  assert.equal(row.meta.path, "NAS/Album/large.wav");
  assert.ok(bytesRead < 100000, `Read ${bytesRead} bytes instead of metadata-sized slices`);
  assert.equal(row.tags.cover, undefined);
  console.log(
    `PASS: 20 MB WAV metadata/duration read using ${bytesRead} bytes; whole-file reads forbidden. Literal matching including exact spaces, trimmed replacements, actionable persistent rename errors, real suffix-removal rename and ZIP stem handling verified.`,
  );
} finally {
  await server.close();
}
