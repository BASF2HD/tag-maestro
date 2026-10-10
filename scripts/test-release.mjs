import { spawnSync } from 'node:child_process';
const tests = ['table-settings','cover-batch-settings','desktop-security','desktop-permissions','folder-renames','folder-save','name-inventory','name-conflicts','name-save-progress','nas-metadata','file-saving','library-metadata','song-actions'];
for (const test of tests) {
  const result = spawnSync(process.execPath, ['scripts/test-' + test + '.mjs'], { stdio: 'inherit' });
  if (result.error || result.status !== 0) throw new Error(test + ' failed: ' + (result.error?.message || result.status));
}
