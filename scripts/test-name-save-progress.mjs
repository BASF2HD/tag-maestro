import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
const { NameInventory } = createRequire(import.meta.url)("../desktop/name-inventory.cjs");
const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "tag-maestro-progress-")));
const library = path.join(root, "Library");
await fs.mkdir(library);
for (const name of ["A.rar", "B.rar", "C.rar"]) await fs.writeFile(path.join(library, name), name);
const engine = new NameInventory(),
  job = await engine.start(library);
await engine.jobs.get(job.id).task;
assert.equal(engine.pollSaveProgress(job.id), null);
assert.throws(() => engine.pollSaveProgress("ungranted"), /Invalid/);
const entries = engine.poll(job.id).entries;
const plans = entries.map((entry) => ({ id: entry.id, name: "New " + entry.name }));
let openCheck;
const gateCheck = new Promise((resolve) => {
  openCheck = resolve;
});
let reportChecking;
const checking = new Promise((resolve) => {
  reportChecking = resolve;
});
const originalCheck = engine.check.bind(engine);
let heldCheck = false;
engine.check = async (...args) => {
  if (!heldCheck && engine.pollSaveProgress(job.id)?.stage === "validating") {
    heldCheck = true;
    reportChecking();
    await gateCheck;
  }
  return originalCheck(...args);
};
let openRename;
const gateRename = new Promise((resolve) => {
  openRename = resolve;
});
let reportRenaming;
const renaming = new Promise((resolve) => {
  reportRenaming = resolve;
});
const originalRename = fs.rename;
let renameCalls = 0;
fs.rename = async (...args) => {
  if (++renameCalls === 2) {
    reportRenaming();
    await gateRename;
  }
  return originalRename(...args);
};
try {
  const save = engine.rename(job.id, plans);
  await checking;
  const validating = engine.pollSaveProgress(job.id);
  assert.equal(validating.stage, "validating");
  assert.equal(validating.total, 3);
  assert.equal(validating.renamed, 0, "checks are not reported as file changes");
  assert.equal(validating.processed, 0);
  assert.ok(validating.current.endsWith(".rar"));
  openCheck();
  await renaming;
  const live = engine.pollSaveProgress(job.id);
  assert.equal(live.stage, "renaming");
  assert.equal(live.renamed, 1);
  assert.equal(live.processed, 1);
  assert.equal(live.stageTotal, 3);
  assert.ok(live.current.includes(" → "));
  live.renamed = 999;
  assert.equal(engine.pollSaveProgress(job.id).renamed, 1, "poll cannot mutate native counters");
  openRename();
  assert.equal((await save).renamed.length, 3);
  const done = engine.pollSaveProgress(job.id);
  assert.equal(done.stage, "complete");
  assert.equal(done.renamed, 3);
  assert.equal(done.processed, 3);
  assert.equal(done.skipped, 0);
  assert.ok(done.updatedAt >= done.startedAt);
} finally {
  openCheck();
  openRename();
  fs.rename = originalRename;
}
// A collision reports waiting-for-choice, then accurate skip totals.
const entry = engine.poll(job.id).entries[0];
const collisionName = engine.poll(job.id).entries[1].name;
const conflictPlans = [{ id: entry.id, name: collisionName }];
const preview = await engine.rename(job.id, conflictPlans);
assert.equal(engine.pollSaveProgress(job.id).stage, "awaiting-choice");
assert.equal(engine.pollSaveProgress(job.id).conflicts, 1);
assert.equal(engine.pollSaveProgress(job.id).renamed, 0);
const skipped = await engine.rename(job.id, conflictPlans, {
  token: preview.conflictToken,
  policy: "skip",
});
assert.equal(skipped.skipped.length, 1);
assert.equal(engine.pollSaveProgress(job.id).stage, "complete");
assert.equal(engine.pollSaveProgress(job.id).skipped, 1);
assert.equal(engine.pollSaveProgress(job.id).renamed, 0);
// Errors report a failed state instead of incorrectly claiming completion.
const failed = await engine.rename(job.id, [{ id: entry.id, name: "../escape.rar" }]);
assert.match(failed.error, /Invalid/);
assert.equal(engine.pollSaveProgress(job.id).stage, "failed");
assert.equal(engine.pollSaveProgress(job.id).renamed, 0);
assert.ok(engine.pollSaveProgress(job.id).error);
await engine.release(job.id);
assert.throws(() => engine.pollSaveProgress(job.id), /Invalid/);
console.log(
  "PASS: real in-flight checking/rename counters, phase separation, current filename, completion, skip counts, errors and scoped read-only snapshots. Only temporary synthetic fixtures touched.",
);
