import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const directory = process.argv[2];
if (!directory) throw new Error('Pass the release asset directory');
const files = (await readdir(directory)).filter(name => !name.startsWith('.') && name !== 'SHA256SUMS').sort();
if (!files.length) throw new Error('No release assets');
const sums = await Promise.all(files.map(async name => {
  const hash = createHash('sha256').update(await readFile(path.join(directory, name))).digest('hex');
  return hash + '  ' + name;
}));
await writeFile(path.join(directory, 'SHA256SUMS'), sums.join('\n') + '\n');
console.log('Checksummed ' + files.length + ' release assets');
