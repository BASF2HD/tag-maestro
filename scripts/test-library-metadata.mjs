import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "vite";

// Synthetic RIFF/ID3 fixtures only. No user music is opened or edited.
const fixture = await mkdtemp(path.join(os.tmpdir(), "tag-maestro-metadata-"));
const server = await createServer({
  configFile: false,
  cacheDir: path.join(fixture, "vite-cache"),
  server: { middlewareMode: true, hmr: false, ws: false },
  optimizeDeps: { noDiscovery: true },
});
const join = (...arrays) => {
  const result = new Uint8Array(arrays.reduce((sum, bytes) => sum + bytes.length, 0));
  let at = 0;
  for (const bytes of arrays) {
    result.set(bytes, at);
    at += bytes.length;
  }
  return result;
};
const text = new TextEncoder();
function chunk(id, data) {
  const result = new Uint8Array(8 + data.length + (data.length & 1));
  result.set(text.encode(id));
  new DataView(result.buffer).setUint32(4, data.length, true);
  result.set(data, 8);
  return result;
}
function picture(type, data) {
  const body = join(
    new Uint8Array([0]),
    text.encode("image/jpeg"),
    new Uint8Array([0, type, 0]),
    data,
  );
  const result = new Uint8Array(10 + body.length);
  result.set(text.encode("APIC"));
  new DataView(result.buffer).setUint32(4, body.length);
  result.set(body, 10);
  return result;
}
try {
  const { readMp3, readEmbeddedArtwork } = await server.ssrLoadModule("/src/lib/mp3.ts");
  const format = new Uint8Array(16),
    view = new DataView(format.buffer);
  view.setUint16(0, 1, true);
  view.setUint16(2, 1, true);
  view.setUint32(4, 8000, true);
  view.setUint32(8, 16000, true);
  view.setUint16(12, 2, true);
  view.setUint16(14, 16, true);
  const disc = new Uint8Array([1, 2, 3]),
    front = new Uint8Array([7, 8, 9]);
  const frames = join(picture(6, disc), picture(3, front));
  const id3 = new Uint8Array(10 + frames.length);
  id3.set([73, 68, 51, 3, 0, 0]);
  let size = frames.length;
  for (let at = 9; at >= 6; at--) {
    id3[at] = size & 127;
    size >>>= 7;
  }
  id3.set(frames, 10);
  const riff = join(
    text.encode("RIFF"),
    new Uint8Array(4),
    text.encode("WAVE"),
    chunk("fmt ", format),
    chunk("data", new Uint8Array(16000)),
    chunk("id3 ", id3),
  );
  new DataView(riff.buffer).setUint32(4, riff.length - 8, true);
  const source = new File([riff], "fixture.wav");
  const scan = await readMp3(source, "Music/Album/song.wav", true, false);
  assert.equal(scan.meta.length, "0:01");
  assert.equal(scan.meta.frequency, "8000 Hz");
  assert.equal(scan.meta.mode, "Mono");
  assert.equal(scan.tags.cover, undefined);
  const selected = await readMp3(source, "Music/Album/song.wav", true, true);
  assert.deepEqual(selected.tags.cover.data, front);
  assert.notDeepEqual(selected.tags.cover.data, disc);
  assert.equal(selected.dirty, false);
  assert.deepEqual((await readEmbeddedArtwork(source)).data, front);
  console.log(
    "PASS: fast-scan duration/sample rate, lazy embedded FrontCover selection ahead of disc artwork; no original files changed.",
  );
} finally {
  await server.close();
}
