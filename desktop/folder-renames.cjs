const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomUUID, createHash } = require('node:crypto');

function segments(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes(':')) throw new Error('Invalid relative folder path');
  const parts = value.split('/');
  if (parts.some(p => !p || p === '.' || p === '..' || /[\x00-\x1f]/.test(p))) throw new Error('Invalid relative folder path');
  return parts;
}
function folderName(value) {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || /[<>:"/\\|?*\x00-\x1f]/.test(value) || /[. ]$/.test(value) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(value)) throw new Error('Invalid folder name: ' + value);
  segments(value);
  return value;
}
const same = (a, b) => a.dev === b.dev && a.ino === b.ino;
async function exists(filename) {
  try { return await fs.lstat(filename); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function checkedDirectory(root, relative) {
  let current = root;
  for (const part of ['', ...segments(relative)]) {
    if (part) current = path.join(current, part);
    const stat = await fs.lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Folder disappeared or is a symbolic link');
  }
  return { filename: current, stat: await fs.lstat(current) };
}
class FolderRenames {
  roots = new Map();
  transactions = new Map();
  async grant(root) {
    root = path.resolve(root);
    if (root === path.parse(root).root || root === os.homedir()) throw new Error('Choose the music library folder, not a drive or home folder');
    const stat = await fs.lstat(root);
    if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(root) !== root) throw new Error('Choose a real library directory, not a symbolic link');
    const token = randomUUID();
    this.roots.set(token, { root, stat });
    return { token, name: path.basename(root) };
  }
  async prepare(token, plans) {
    const scope = this.roots.get(token);
    if (!scope || !same(scope.stat, await fs.lstat(scope.root))) throw new Error('Library access expired; choose the library again');
    if (!Array.isArray(plans) || !plans.length || plans.length > 10000) throw new Error('Invalid rename batch');
    const records = [];
    const destinations = new Set();
    for (const plan of plans) {
      const relative = segments(plan.relative).join('/');
      const name = folderName(plan.name);
      const source = await checkedDirectory(scope.root, relative);
      const destination = path.join(path.dirname(source.filename), name);
      if (await exists(destination)) throw new Error('Folder already exists: ' + name);
      const destinationKey = destination.toLowerCase();
      if (destinations.has(destinationKey)) throw new Error('Two folders would have the same name: ' + name);
      destinations.add(destinationKey);
      const anchorName = folderName(plan.anchor.name);
      const anchorPath = path.join(source.filename, anchorName);
      const anchor = await fs.open(anchorPath, 'r');
      try {
        const stat = await fs.lstat(anchorPath);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== plan.anchor.size || Math.trunc(stat.mtimeMs) !== plan.anchor.modified || !same(stat, await anchor.stat())) throw new Error('Music file changed or the wrong library was chosen');
        const buffer = Buffer.alloc(Math.min(65536, stat.size));
        await anchor.read(buffer, 0, buffer.length, 0);
        if (createHash('sha256').update(buffer).digest('hex') !== plan.anchor.digest) throw new Error('The selected library does not match the loaded songs');
      } finally { await anchor.close(); }
      records.push({ relative, name, source: source.filename, destination, stat: source.stat });
    }
    const sources = new Set(records.map(record => record.relative));
    if (sources.size !== records.length) throw new Error('One folder has conflicting rename requests');
    for (const record of records) {
      const parents = record.relative.split('/');
      while (parents.length > 1) {
        parents.pop();
        if (sources.has(parents.join('/'))) throw new Error('Rename parent and nested folders in separate saves');
      }
    }
    const transaction = randomUUID();
    this.transactions.set(transaction, { scope, records });
    return transaction;
  }
  async commit(transaction) {
    const batch = this.transactions.get(transaction);
    this.transactions.delete(transaction);
    if (!batch) throw new Error('Rename authorization expired');
    const completed = [];
    try {
      if (!same(batch.scope.stat, await fs.lstat(batch.scope.root))) throw new Error('Library folder changed; choose it again');
      for (const record of batch.records) {
        const current = await checkedDirectory(batch.scope.root, record.relative);
        if (!same(current.stat, record.stat) || await exists(record.destination)) throw new Error('Folder changed or destination now exists; no overwrite was allowed');
      }
      for (const record of batch.records) {
        const current = await checkedDirectory(batch.scope.root, record.relative);
        if (!same(current.stat, record.stat) || await exists(record.destination)) throw new Error('Folder changed during saving');
        // Same parent and volume: a directory rename, never a copy/delete operation.
        await fs.rename(record.source, record.destination);
        completed.push(record);
      }
      return { renamed: completed.map(({ relative, name }) => ({ relative, name })) };
    } catch (error) {
      // Undo completed renames when safe; never overwrite an externally-created folder.
      const remaining = [];
      for (const record of completed.reverse()) {
        try {
          if (await exists(record.source) || !same(record.stat, await fs.lstat(record.destination))) throw new Error('Cannot roll back safely');
          await fs.rename(record.destination, record.source);
        } catch { remaining.push(record); }
      }
      return { renamed: remaining.map(({ relative, name }) => ({ relative, name })), error: String(error.message || error) };
    }
  }
}
module.exports = { FolderRenames, segments, folderName, same, exists, checkedDirectory };
