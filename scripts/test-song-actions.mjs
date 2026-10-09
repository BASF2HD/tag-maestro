import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, stat, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "vite";

// All disk operations target generated fixtures in this disposable directory.
const temporary = await mkdtemp(path.join(os.tmpdir(), "tagmaestro-song-actions-"));
const server = await createServer({
  configFile: false,
  cacheDir: path.join(temporary, "cache"),
  server: { middlewareMode: true, hmr: false, ws: false },
  optimizeDeps: { noDiscovery: true },
});
try {
  const { previewPage, previewScrollTop } = await server.ssrLoadModule(
    "/src/lib/preview-visibility.ts",
  );
  const orderedTracks = Array.from({ length: 120 }, (_, index) => ({ id: String(index) }));
  assert.equal(previewPage(orderedTracks, "49", 50), 1);
  assert.equal(previewPage(orderedTracks, "50", 50), 2);
  assert.equal(previewPage(orderedTracks, "119", 50), 3);
  assert.equal(previewPage([...orderedTracks].reverse(), "119", 50), 1);
  assert.equal(previewPage(orderedTracks, "missing", 50), null);
  assert.equal(previewScrollTop(200, 100, 400, 20, 200, 224), 200);
  assert.ok(previewScrollTop(200, 100, 400, 20, 90, 114) < 200);
  assert.ok(previewScrollTop(200, 100, 400, 20, 550, 574) > 200);
  assert.equal(previewScrollTop(0, 100, 400, 20, 0, 24), 0);
  const { AudioPreview, previewNeighbours } = await server.ssrLoadModule(
    "/src/lib/audio-preview.ts",
  );
  const { deleteSongFile, deleteSongBatch, nextAfterDeletion } =
    await server.ssrLoadModule("/src/lib/delete-song.ts");
  const deletionOrder = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
  assert.equal(nextAfterDeletion(deletionOrder, "a", new Set(["a"])).id, "b");
  assert.equal(nextAfterDeletion(deletionOrder, "a", new Set(["a", "b", "c"])).id, "d");
  assert.equal(nextAfterDeletion(deletionOrder, "d", new Set(["d"])), undefined);
  assert.equal(nextAfterDeletion(deletionOrder, "a", new Set(["b"])), undefined);
  assert.equal(nextAfterDeletion([...deletionOrder].reverse(), "d", new Set(["d"])).id, "c");
  assert.equal(nextAfterDeletion(deletionOrder, "a", new Set(["a", "b", "c", "d"])), undefined);
  assert.equal(nextAfterDeletion(deletionOrder, "missing", new Set(["missing"])), undefined);
  const visited = [];
  let removing = false;
  const batch = await deleteSongBatch(
    deletionOrder,
    () => {},
    async (song) => {
      assert.equal(removing, false, "Deletes must be sequential");
      removing = true;
      visited.push(song.id);
      await Promise.resolve();
      removing = false;
      if (song.id === "b") throw new Error("Permission denied");
    },
  );
  assert.deepEqual(visited, ["a", "b", "c", "d"]);
  assert.deepEqual(batch.deleted, ["a", "c", "d"]);
  assert.equal(batch.failed[0].song.id, "b");
  assert.equal(batch.failed[0].message, "Permission denied");
  assert.equal(nextAfterDeletion(deletionOrder, "a", new Set(batch.deleted)).id, "b");
  const { detectFormat, SUPPORTED_EXTS, requireTagWritable } = await server.ssrLoadModule(
    "/src/lib/audio-formats.ts",
  );
  for (const extension of SUPPORTED_EXTS)
    assert.notEqual(detectFormat({ name: `song${extension.toUpperCase()}`, type: "" }), "other");
  assert.equal(detectFormat({ name: "song.flac", type: "audio/mpeg" }), "flac");
  assert.equal(detectFormat({ name: "song", type: "audio/x-aiff" }), "aiff");
  assert.equal(detectFormat({ name: "archive.arc", type: "" }), "other");
  assert.throws(() => requireTagWritable("aac"), /Raw AAC/);
  for (const extension of SUPPORTED_EXTS.filter(
    (extension) => ![".aac", ".adts"].includes(extension),
  )) {
    requireTagWritable(detectFormat({ name: `song${extension}`, type: "" }));
  }

  class FakeAudio extends EventTarget {
    paused = true;
    ended = false;
    currentTime = 0;
    duration = NaN;
    src = "";
    error = null;
    async play() {
      if (this.rejection) throw this.rejection;
      this.duration = 120;
      this.dispatchEvent(new Event("loadedmetadata"));
      this.paused = false;
      this.dispatchEvent(new Event("playing"));
    }
    pause() {
      this.paused = true;
      this.dispatchEvent(new Event("pause"));
    }
    removeAttribute() {
      this.src = "";
    }
    load() {
      this.currentTime = 0;
      this.duration = NaN;
    }
  }
  const audio = new FakeAudio();
  const states = [],
    errors = [];
  const player = new AudioPreview(
    audio,
    (state) => states.push(state),
    (message) => errors.push(message),
  );
  const first = { id: "one", file: new File(["one"], "one.wav") };
  const second = { id: "two", file: new File(["two"], "two.mp3") };
  const navigation = [first, second];
  assert.equal(previewNeighbours(navigation, "one").previous, undefined);
  assert.equal(previewNeighbours(navigation, "one").next, second);
  assert.equal(previewNeighbours(navigation, "two").previous, first);
  assert.equal(previewNeighbours(navigation, "two").next, undefined);
  assert.equal(previewNeighbours(navigation, "hidden").next, undefined);
  await player.toggle(first);
  assert.equal(player.state.playing, true);
  const initialUrl = audio.src;
  await player.toggle(first);
  assert.equal(player.state.playing, false);
  player.seek(45);
  assert.equal(audio.currentTime, 45);
  assert.equal(player.state.playing, false, "Seeking a paused song must not play it");
  player.seek(999);
  assert.equal(audio.currentTime, 120);
  player.seek(-10);
  assert.equal(audio.currentTime, 0);
  player.seek(NaN);
  assert.equal(audio.currentTime, 0);
  await player.toggle(first);
  assert.equal(audio.src, initialUrl, "Resume must retain playback position/source");
  await player.toggle(second);
  assert.equal(player.state.id, "two");
  assert.notEqual(audio.src, initialUrl);
  const previousStateUpdates = states.length;
  let ticks = 0;
  const unsubscribe = player.subscribeTimeline(() => ticks++);
  audio.currentTime = 20;
  audio.dispatchEvent(new Event("timeupdate"));
  assert.equal(player.getTimeline().position, 20);
  assert.equal(player.getTimeline().duration, 120);
  assert.equal(
    states.length,
    previousStateUpdates,
    "Clock ticks must not rerender the whole table",
  );
  assert.equal(ticks, 1);
  unsubscribe();
  audio.currentTime = 21;
  audio.dispatchEvent(new Event("timeupdate"));
  assert.equal(ticks, 1);
  await player.seekFraction(first, 0.5);
  assert.equal(player.state.id, "one");
  assert.equal(audio.currentTime, 60, "Inactive quick seek must start at the chosen fraction");
  await player.toggle(second);
  audio.ended = true;
  audio.dispatchEvent(new Event("ended"));
  assert.equal(player.state.playing, false);
  await player.toggle(second);
  assert.equal(audio.currentTime, 0);
  let resolveFile;
  const slow = {
    id: "slow",
    file: first.file,
    sourceHandle: {
      getFile: () =>
        new Promise((resolve) => {
          resolveFile = resolve;
        }),
    },
  };
  const pending = player.toggle(slow);
  await player.toggle(second);
  resolveFile(first.file);
  await pending;
  assert.equal(player.state.id, "two", "Late reads cannot replace the new track");
  const pendingSeek = player.seekFraction(slow, 0.25);
  await player.seekFraction(slow, 0.75);
  resolveFile(first.file);
  await pendingSeek;
  assert.equal(audio.currentTime, 90, "Latest seek while metadata loads must win");
  const staleSeek = player.seekFraction({ ...slow, id: "new-slow" }, 0.8);
  await player.toggle(second);
  resolveFile(first.file);
  await staleSeek;
  assert.equal(player.state.id, "two");
  assert.equal(audio.currentTime, 0, "Old pending seek must never affect the next track");
  audio.rejection = new DOMException("Codec unsupported", "NotSupportedError");
  await player.toggle(first);
  assert.equal(player.state.id, null);
  assert.equal(errors.length, 1);
  audio.rejection = undefined;
  const cancelled = player.toggle(slow);
  await player.toggle(slow);
  resolveFile(first.file);
  await cancelled;
  assert.equal(player.state.id, null);
  await player.toggle(first);
  player.stop();
  assert.equal(audio.src, "");
  assert.equal(audio.paused, true);
  assert.deepEqual(player.getTimeline(), { position: 0, duration: 0 });
  player.destroy();

  const target = path.join(temporary, "song.wav");
  const neighbour = path.join(temporary, "other.wav");
  await writeFile(target, "TEST ONLY");
  await writeFile(neighbour, "KEEP THIS");
  const getFile = async () =>
    new File([await readFile(target)], "song.wav", {
      lastModified: Math.round((await stat(target)).mtimeMs),
    });
  const handle = { name: "song.wav", getFile, isSameEntry: async (other) => other === handle };
  let deleted = 0;
  const directory = {
    queryPermission: async () => "granted",
    getFileHandle: async (name, options) => {
      assert.equal(name, "song.wav");
      assert.equal(options.create, false);
      try {
        await access(target);
      } catch {
        throw new DOMException("Missing", "NotFoundError");
      }
      return handle;
    },
    removeEntry: async (name, options) => {
      assert.equal(name, "song.wav");
      assert.equal(options.recursive, false);
      const { unlink } = await import("node:fs/promises");
      await unlink(target);
      deleted++;
    },
  };
  const song = { file: await getFile(), sourceHandle: handle, sourceDirectoryHandle: directory };
  await assert.rejects(
    deleteSongFile({ ...song, sourceDirectoryHandle: undefined }),
    /Open Folder/,
  );
  await assert.rejects(
    deleteSongFile({
      ...song,
      sourceDirectoryHandle: { ...directory, queryPermission: async () => "denied" },
    }),
    /permission/,
  );
  await assert.rejects(
    deleteSongFile({ ...song, sourceHandle: { ...handle, isSameEntry: async () => false } }),
    /identity/,
  );
  await assert.rejects(
    deleteSongFile({ ...song, file: new File(["changed"], "song.wav", { lastModified: 1 }) }),
    /changed on disk/,
  );
  await assert.rejects(
    deleteSongFile({ ...song, sourceHandle: { ...handle, name: "../song.wav" } }),
    /filename/,
  );
  await assert.rejects(
    deleteSongFile({
      ...song,
      sourceDirectoryHandle: { ...directory, removeEntry: async () => {} },
    }),
    /still present/,
  );
  assert.equal(deleted, 0, "Safety refusals must not delete anything");
  await deleteSongFile(song);
  assert.equal(deleted, 1);
  assert.equal(await readFile(neighbour, "utf8"), "KEEP THIS");
  console.log(
    "PASS: format aliases, raw-AAC write guard, play/pause/resume/switch/end, stale-read cancellation, codec errors, stop/unmount and verified single-file disk deletion with safety refusals. Fixtures retained at:",
    temporary,
  );
} finally {
  await server.close();
}
