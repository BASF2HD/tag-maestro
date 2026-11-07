import { spawnSync } from 'node:child_process';
const tests = ['table-settings','cover-batch-settings','desktop-security','bundle-assets','desktop-permissions','folder-renames','folder-save','name-inventory','name-conflicts','name-save-progress','nas-metadata','file-saving','library-metadata','song-actions','filename-extraction'];
for (const test of tests) {
  const result = spawnSync(process.execPath, ['scripts/test-' + test + '.mjs'], { stdio: 'inherit' });
  if (result.error || result.status !== 0) throw new Error(test + ' failed: ' + (result.error?.message || result.status));
}

const metadata = spawnSync(process.execPath, ['scripts/test-album-metadata.cjs'], { stdio: 'inherit' });
if (metadata.error || metadata.status !== 0) throw new Error('album-metadata failed: ' + (metadata.error?.message || metadata.status));
