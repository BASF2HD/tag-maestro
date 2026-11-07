import { readdir, readFile, writeFile, rename, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const directory = process.argv[2];
if (!directory) throw new Error('Pass the release asset directory');
// GitHub normalizes spaces to dots in asset names. Normalize before hashing so
// the downloaded filenames and SHA256SUMS agree.
for (const name of await readdir(directory)) {
  const safeName = name.replaceAll(' ', '.');
  if (safeName === name) continue;
  let exists = false;
  try { await access(path.join(directory, safeName)); exists = true; } catch {}
  if (exists) throw new Error('Normalized release filename already exists: ' + safeName);
  await rename(path.join(directory, name), path.join(directory, safeName));
}
const files = (await readdir(directory)).filter(name => !name.startsWith('.') && name !== 'SHA256SUMS').sort();
if (!files.length) throw new Error('No release assets');
if (process.argv.includes('--require-desktop-set')) {
  const { version } = JSON.parse(await readFile('package.json', 'utf8'));
  const expected = [
    ...['arm64', 'x64'].flatMap(arch => ['dmg', 'zip'].map(ext => `Tag.Maestro-${version}-mac-${arch}.${ext}`)),
    ...['Setup', 'Portable'].map(kind => `Tag.Maestro-${version}-win-x64-${kind}.exe`),
  ];
  if (files.length !== expected.length || expected.some(name => !files.includes(name)))
    throw new Error('Incomplete desktop release: require Apple Silicon and Intel Mac DMG/ZIP plus Windows Setup/Portable for ' + version);
}

const sums = await Promise.all(files.map(async name => {
  const hash = createHash('sha256').update(await readFile(path.join(directory, name))).digest('hex');
  return hash + '  ' + name;
}));
await writeFile(path.join(directory, 'SHA256SUMS'), sums.join('\n') + '\n');
console.log('Checksummed ' + files.length + ' release assets');
