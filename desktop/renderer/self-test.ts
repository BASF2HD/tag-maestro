import {
  readMp3,
  writeCoverToBlob,
  verifyWrittenArtwork,
  writeTagsToBlob,
} from "../../src/lib/mp3";
import { writeVerifiedFile } from "../../src/lib/verified-file-write";
import { deleteSongBatch } from "../../src/lib/delete-song";
import { AudioPreview } from "../../src/lib/audio-preview";
import { saveLibrarySource, listLibrarySources } from "../../src/lib/library-storage";
import {
  defaultTableSettings,
  loadTableSettings,
  saveTableSettings,
} from "../../src/lib/table-settings";

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function pcm() {
  const data = new Uint8Array(16000);
  const buffer = new Uint8Array(44 + data.length),
    view = new DataView(buffer.buffer),
    enc = new TextEncoder();
  buffer.set(enc.encode("RIFF"));
  view.setUint32(4, buffer.length - 8, true);
  buffer.set(enc.encode("WAVEfmt "), 8);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true);
  view.setUint32(28, 16000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  buffer.set(enc.encode("data"), 36);
  view.setUint32(40, data.length, true);
  buffer.set(data, 44);
  return buffer;
}
async function put(directory: FileSystemDirectoryHandle, name: string, data: Blob) {
  const handle = await directory.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(data);
  await writable.close();
  return handle;
}
export async function runDesktopSelfTest() {
  const passed: string[] = [];
  try {
    check(isSecureContext && location.host === "app", "Secure fixed app origin");
    check(typeof (window as any).require === "undefined", "No Node in renderer");
    check(
      typeof (window as any).showDirectoryPicker === "function" &&
        typeof (window as any).showOpenFilePicker === "function",
      "Native Chromium file pickers",
    );
    passed.push("secure origin, sandbox, native picker APIs");
    const defaults = defaultTableSettings(["album", "track", "title"], ["album", "title"]);
    const stage = new URL(location.href).searchParams.get("selftest");
    const root = await navigator.storage.getDirectory();
    if (stage === "read") {
      check(
        localStorage.getItem("desktop-test-persistent") === "saved",
        "Local storage survives process restart",
      );
      const restored = loadTableSettings(defaults);
      check(
        restored.columnOrder[0] === "title" &&
          restored.sortKey === "title" &&
          restored.sortOrder === "desc",
        "Table preferences survive restart",
      );
      const sources = await listLibrarySources();
      check(
        sources.length === 1 && sources[0].kind === "directory",
        "Library handle survives restart",
      );
      const handle = await (sources[0].handle as FileSystemDirectoryHandle).getFileHandle(
        "desktop-test.wav",
      );
      const row = await readMp3(await handle.getFile());
      check(row.tags.title === "Desktop verified title", "Saved song metadata survives restart");
      passed.push(
        "restart persistence: layout, sorting, IndexedDB library handle and verified song tags",
      );
    } else {
      const folder = await root.getDirectoryHandle("synthetic-desktop-test", { create: true });
      const handle = await put(
        folder,
        "desktop-test.wav",
        new Blob([pcm()], { type: "audio/wav" }),
      );
      const row = await readMp3(await handle.getFile(), undefined, true, false, handle, folder);
      check(
        row.meta.length === "0:01" && row.meta.frequency === "8000 Hz",
        "Header duration and sample rate are available when decoding is skipped",
      );
      passed.push("scan-time duration without audio decoding");
      row.tags.title = "Desktop verified title";
      const output = await writeTagsToBlob(row);
      const saved = await writeVerifiedFile(handle, output);
      check((await readMp3(saved)).tags.title === row.tags.title, "WASM metadata read/write");
      passed.push("bundled TagLib WASM, metadata write and exact byte read-back");
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 32;
      canvas.getContext("2d")!.fillStyle = "#eab75a";
      canvas.getContext("2d")!.fillRect(0, 0, 32, 32);
      const image = await new Promise<Blob>((resolve) =>
        canvas.toBlob((blob) => resolve(blob!), "image/png"),
      );
      const cover = {
        data: new Uint8Array(await image.arrayBuffer()),
        mime: "image/png",
        dataUrl: "",
      };
      const covered = await writeVerifiedFile(handle, await writeCoverToBlob(saved, cover));
      await verifyWrittenArtwork(covered, cover);
      const coverRow = await readMp3(covered);
      coverRow.tags.cover = undefined;
      coverRow.coverEdited = true;
      const cleared = await writeVerifiedFile(handle, await writeTagsToBlob(coverRow));
      await verifyWrittenArtwork(cleared, undefined);
      passed.push("embedded artwork replacement/removal on isolated real filesystem handles");
      const player = new AudioPreview(
        new Audio(),
        () => {},
        (message) => {
          throw new Error(message);
        },
      );
      await player.toggle({ id: "test", file: cleared });
      check(player.state.playing && player.getTimeline().duration > 0, "Original audio playback");
      player.seek(0.5);
      check(player.getTimeline().position >= 0.49, "Audio seek");
      player.destroy();
      passed.push("audio playback and seek");
      const deletedRows = [];
      for (const name of ["delete-a.wav", "delete-b.wav"]) {
        const fileHandle = await put(folder, name, new Blob([pcm()]));
        deletedRows.push(
          await readMp3(await fileHandle.getFile(), undefined, true, false, fileHandle, folder),
        );
      }
      const deletion = await deleteSongBatch(deletedRows);
      check(
        deletion.deleted.length === 2 && deletion.failed.length === 0,
        "Verified bulk deletion",
      );
      check((await handle.getFile()).name === "desktop-test.wav", "Neighbour retained");
      passed.push("verified native-handle bulk deletion; neighbouring file preserved");
      await saveLibrarySource({
        id: "desktop-self-test",
        name: folder.name,
        kind: "directory",
        handle: folder,
        excludedPaths: [],
        addedAt: Date.now(),
      });
      localStorage.setItem("desktop-test-persistent", "saved");
      check(
        saveTableSettings({
          ...defaults,
          columnOrder: ["title", "album", "track"],
          sortKey: "title",
          sortOrder: "desc",
        }),
        "Preference save",
      );
      passed.push("persistent library capability and table settings saved");
    }
    document.documentElement.dataset.desktopTest = JSON.stringify({ ok: true, stage, passed });
  } catch (error) {
    document.documentElement.dataset.desktopTest = JSON.stringify({
      ok: false,
      passed,
      error: String(error),
    });
  }
}
