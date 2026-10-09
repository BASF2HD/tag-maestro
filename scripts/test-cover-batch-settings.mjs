import assert from "node:assert/strict";
import {
  BATCH_SIZES,
  DEFAULT_BATCH_SIZE,
  MAX_BATCH,
  MAX_ARCHIVE_BYTES,
  savedCoverBatchSize,
} from "../src/lib/cover-batch-settings.ts";
assert.equal(savedCoverBatchSize(), DEFAULT_BATCH_SIZE);
for (const size of BATCH_SIZES) {
  globalThis.window = { localStorage: { getItem: () => String(size) } };
  assert.equal(savedCoverBatchSize(), size);
}
for (const value of [null, "broken", "0", "-1", "5000", "26"]) {
  globalThis.window = { localStorage: { getItem: () => value } };
  assert.equal(savedCoverBatchSize(), DEFAULT_BATCH_SIZE);
}
globalThis.window = {
  localStorage: {
    getItem: () => {
      throw new Error("Storage unavailable");
    },
  },
};
assert.equal(savedCoverBatchSize(), DEFAULT_BATCH_SIZE);
delete globalThis.window;
assert.equal(MAX_BATCH, 500);
assert.equal(MAX_ARCHIVE_BYTES, 512 * 1024 * 1024);
console.log(
  "PASS: 25/50/100/250/500 batch options, remembered size, invalid/missing/blocked storage fallback, archive limits.",
);
