import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { createServer } from 'vite';
const { FolderRenames } = createRequire(import.meta.url)('../desktop/folder-renames.cjs');
const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'tag-maestro-folder-save-')));
const rootName = path.basename(root);
const service = new FolderRenames();
function directory(filename) {
  return {
    async getDirectoryHandle(name) { const full = path.join(filename, name); assert.ok((await fs.stat(full)).isDirectory()); return directory(full); },
    async getFileHandle(name) { const full = path.join(filename, name); return { async getFile() { const stat = await fs.stat(full); return new File([await fs.readFile(full)], name, { lastModified: Math.trunc(stat.mtimeMs) }); } }; },
  };
}
let sources = [{ id: 'fixture', kind: 'directory', handle: directory(root), name: rootName, addedAt: 0, excludedPaths: [`${rootName}/Album/deleted.wav`] }];
// In-memory IDB adapter: exercises path persistence without accessing the user's database.
globalThis.indexedDB = { open() { const request = {}; queueMicrotask(() => { request.result = { close() {}, transaction() { return { objectStore() { return { getAll() { const r = {}; queueMicrotask(() => { r.result = sources; r.onsuccess(); }); return r; }, put(value) { const r = {}; sources = [value]; queueMicrotask(() => { r.result = value.id; r.onsuccess(); }); return r; } }; } }; } }; request.onsuccess(); }); return request; } };
globalThis.window = { tagMaestroDesktop: { chooseRenameRoot: () => service.grant(root), prepareFolderRenames: (token, plans) => service.prepare(token, plans), commitFolderRenames: tx => service.commit(tx) } };
await fs.mkdir(path.join(root, 'Album', 'Extras'), { recursive: true });
for (const file of ['Album/one.wav', 'Album/two.flac', 'Album/Extras/three.mp3']) await fs.writeFile(path.join(root, file), 'synthetic unchanged audio');
const server = await createServer({ configFile: false, cacheDir: path.join(root, 'vite-cache'), server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true } });
try {
  const { prepareOriginalFolderRenames, hasTagEdits } = await server.ssrLoadModule('/src/lib/folder-renames.ts');
  const rows = [];
  for (const [index, relative] of ['Album/one.wav', 'Album/two.flac', 'Album/Extras/three.mp3'].entries()) {
    const folderPath = `${rootName}/${path.posix.dirname(relative)}`;
    const albumHandle = directory(path.join(root, path.posix.dirname(relative)));
    const handle = await albumHandle.getFileHandle(path.posix.basename(relative));
    const tags = { title: 'Song', artist: 'Artist' };
    rows.push({ id: String(index), file: await handle.getFile(), sourceHandle: handle, sourceDirectoryHandle: albumHandle, sourceFolderParentHandle: directory(path.dirname(path.join(root, path.posix.dirname(relative)))), librarySourceId: 'fixture', libraryRelativePath: `${rootName}/${relative}`, folderPath, folderName: path.posix.basename(folderPath), editedFolderName: index === 0 ? 'Renamed Album' : path.posix.basename(folderPath), tags, original: { ...tags }, meta: { path: `${rootName}/${relative}` }, dirty: index === 0 });
  }
  // Unselected pending tag edits must survive a selected folder-only save.
  rows[1].tags.title = 'Unsaved title'; rows[1].dirty = true;
  assert.equal(hasTagEdits(rows[0]), false);
  const save = await prepareOriginalFolderRenames(rows, [rows[0]]);
  let updated;
  assert.equal(await save(rows, result => { updated = result; }), 1);
  assert.equal(updated.size, 3);
  assert.equal(updated.get('0').dirty, false);
  assert.equal(updated.get('1').dirty, true);
  assert.equal(updated.get('1').tags.title, 'Unsaved title');
  for (const row of updated.values()) {
    assert.match(row.libraryRelativePath, /Renamed Album/);
    assert.match(row.meta.path, /Renamed Album/);
    assert.equal(await (await row.sourceHandle.getFile()).text(), 'synthetic unchanged audio');
  }
  assert.equal(sources[0].excludedPaths[0], `${rootName}/Renamed Album/deleted.wav`);
  globalThis.window = {};
  await assert.rejects(prepareOriginalFolderRenames(rows, [rows[0]]), /desktop app/);
  console.log('PASS: Save originals folder-only workflow; unselected and nested songs, re-bound file handles, pending tags and persisted exclusions. Fixtures: ' + root);
} finally { await server.close(); }
