import assert from "node:assert/strict";
import { createServer } from "vite";
import { mkdtemp } from "node:fs/promises";
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
    `PASS: 20 MB WAV metadata/duration read using ${bytesRead} bytes; whole-file reads forbidden. Literal find/replace and ZIP stem handling verified.`,
  );
} finally {
  await server.close();
}
