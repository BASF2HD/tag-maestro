import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "vite";
import { writeVerifiedFile } from "../src/lib/verified-file-write.ts";
import { wavChunks } from "../src/lib/wav-artwork.ts";

// Only the disposable directory below is written; no library files are changed.
const temporary = await mkdtemp(path.join(os.tmpdir(), "tag-maestro-save-test-"));
const server = await createServer({
  configFile: false,
  cacheDir: path.join(temporary, "vite-cache"),
  server: { middlewareMode: true, hmr: false, ws: false },
  optimizeDeps: { noDiscovery: true },
});
try {
  const { readMp3, writeTagsToBlob, writeCoverToBlob, verifyWrittenArtwork } =
    await server.ssrLoadModule("/src/lib/mp3.ts");
  // Minimal valid PCM WAV, deliberately not a real song.
  const pcm = new Uint8Array(128);
  pcm.forEach((_, index) => {
    pcm[index] = index;
  });
  const bytes = new Uint8Array(44 + pcm.length);
  const view = new DataView(bytes.buffer);
  const text = new TextEncoder();
  bytes.set(text.encode("RIFF"));
  view.setUint32(4, bytes.length - 8, true);
  bytes.set(text.encode("WAVEfmt "), 8);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true);
  view.setUint32(28, 16000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  bytes.set(text.encode("data"), 36);
  view.setUint32(40, pcm.length, true);
  bytes.set(pcm, 44);
  const cover = { data: new Uint8Array([11, 12, 13]), mime: "image/jpeg", dataUrl: "" };
  const base = new File([bytes], "test.wav");
  const withCover = new File([await writeCoverToBlob(base, cover)], base.name);
  await verifyWrittenArtwork(withCover, cover);
  const row = await readMp3(withCover, undefined, true);
  // Comment dropdown <blank> must actually remove existing embedded metadata.
  row.tags.comment = "First comment\nSecond line";
  const commented = new File([await writeTagsToBlob(row)], base.name);
  const commentedRow = await readMp3(commented, undefined, true);
  assert.equal(commentedRow.tags.comment, row.tags.comment);
  commentedRow.tags.comment = "";
  const blankComment = new File([await writeTagsToBlob(commentedRow)], base.name);
  assert.equal((await readMp3(blankComment, undefined, true)).tags.comment, "");
  assert.deepEqual(
    wavChunks(new Uint8Array(await blankComment.arrayBuffer())).find((c) => c.id === "data").body,
    pcm,
  );
  row.coverEdited = true;
  row.tags.cover = undefined;
  const removed = await writeTagsToBlob(row);
  await verifyWrittenArtwork(new File([removed], base.name), undefined);
  assert.deepEqual(
    wavChunks(new Uint8Array(await removed.arrayBuffer())).find((c) => c.id === "data").body,
    pcm,
  );
  // Deletion must also work when artwork was not loaded during the initial scan.
  row.original.cover = undefined;
  const unloadedRemoval = await writeTagsToBlob(row);
  await verifyWrittenArtwork(new File([unloadedRemoval], base.name), undefined);
  row.tags.cover = { ...cover, data: new Uint8Array([21, 22, 23]) };
  const replaced = await writeTagsToBlob(row);
  await verifyWrittenArtwork(new File([replaced], base.name), row.tags.cover);
  await assert.rejects(
    verifyWrittenArtwork(new File([replaced], base.name), cover),
    /Artwork verification failed/,
  );
  const destination = path.join(temporary, "test.wav");
  await writeFile(destination, bytes);
  const handle = {
    getFile: async () => new File([await readFile(destination)], base.name),
    createWritable: async () => ({
      write: async (blob) => writeFile(destination, new Uint8Array(await blob.arrayBuffer())),
      close: async () => {},
      abort: async () => {},
    }),
  };
  const saved = await writeVerifiedFile(handle, replaced);
  await verifyWrittenArtwork(saved, row.tags.cover);
  // Simulate a filesystem silently ignoring writes: it must never report success.
  const ignored = {
    ...handle,
    createWritable: async () => ({
      write: async () => {},
      close: async () => {},
      abort: async () => {},
    }),
  };
  await assert.rejects(writeVerifiedFile(ignored, removed), /Read-back verification failed/);
  let aborted = false;
  const failed = {
    ...handle,
    createWritable: async () => ({
      write: async () => {
        throw new Error("Disk full");
      },
      close: async () => {},
      abort: async () => {
        aborted = true;
      },
    }),
  };
  await assert.rejects(writeVerifiedFile(failed, removed), /Disk full/);
  assert.equal(aborted, true);
  console.log(
    "PASS: multiline comment replacement/removal, embedded cover replacement/deletion (including unloaded artwork), unchanged PCM audio, actual disk read-back, silent-write refusal and failed-write abort.",
  );
} finally {
  await server.close();
  await rm(temporary, { recursive: true, force: true });
}
