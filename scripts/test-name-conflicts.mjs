import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
const { NameInventory } = createRequire(import.meta.url)("../desktop/name-inventory.cjs");
const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "tag-maestro-conflicts-")));
async function fixture(label, folders = false) {
  const library = path.join(root, label);
  await fs.mkdir(library);
  if (folders) {
    for (const [name, text] of [
      ["Old", "incoming"],
      ["Existing", "previous"],
    ]) {
      await fs.mkdir(path.join(library, name));
      await fs.writeFile(path.join(library, name, "music.rar"), text);
    }
  } else {
    for (const [name, text] of [
      ["Old.rar", "incoming"],
      ["Existing.rar", "previous"],
      ["Free.rar", "free"],
    ])
      await fs.writeFile(path.join(library, name), text);
  }
  const engine = new NameInventory(),
    job = await engine.start(library);
  await engine.jobs.get(job.id).task;
  const entries = engine.poll(job.id).entries;
  const ids = new Map(entries.map((item) => [item.relative, item.id]));
  const id = (name) => ids.get(name);
  const plans = [
    { id: id(folders ? "Old" : "Old.rar"), name: folders ? "Existing" : "Existing.rar" },
  ];
  if (!folders) plans.push({ id: id("Free.rar"), name: "Renamed.rar" });
  return { engine, job, library, entries, id, plans };
}
const read = (f, name) => fs.readFile(path.join(f.library, name), "utf8");
const choose = (result, policy) => ({ token: result.conflictToken, policy });
{
  const f = await fixture("Skip");
  const preview = await f.engine.rename(f.job.id, f.plans);
  assert.equal(preview.conflicts.length, 1);
  assert.equal(await read(f, "Free.rar"), "free", "nothing renamed before the user chooses");
  const result = await f.engine.rename(f.job.id, f.plans, choose(preview, "skip"));
  assert.equal(result.renamed.length, 1);
  assert.equal(result.skipped.length, 1);
  assert.equal(await read(f, "Old.rar"), "incoming");
  assert.equal(await read(f, "Existing.rar"), "previous");
  assert.equal(await read(f, "Renamed.rar"), "free");
}
{
  const f = await fixture("Overwrite");
  const original = await fs.stat(path.join(f.library, "Existing.rar"));
  const incoming = await fs.stat(path.join(f.library, "Old.rar"));
  const preview = await f.engine.rename(f.job.id, f.plans);
  const result = await f.engine.rename(f.job.id, f.plans, choose(preview, "overwrite"));
  assert.equal(result.renamed.length, 2);
  assert.equal(result.backups.length, 1);
  assert.equal(await read(f, "Existing.rar"), "incoming");
  assert.equal(await read(f, result.backups[0].backup), "previous");
  assert.equal((await fs.stat(path.join(f.library, "Existing.rar"))).ino, incoming.ino);
  assert.equal((await fs.stat(path.join(f.library, result.backups[0].backup))).ino, original.ino);
  assert.ok(result.removedIds.includes(f.id("Existing.rar")));
  assert.equal(
    f.engine.poll(f.job.id).entries.filter((item) => item.name === "Existing.rar").length,
    1,
  );
  const relisted = await f.engine.start(f.library);
  await f.engine.jobs.get(relisted.id).task;
  assert.equal(
    f.engine
      .poll(relisted.id)
      .entries.some((item) => item.name.startsWith(".tag-maestro-replaced-")),
    false,
  );
}
{
  const f = await fixture("Folders", true);
  const preview = await f.engine.rename(f.job.id, f.plans);
  const result = await f.engine.rename(f.job.id, f.plans, choose(preview, "overwrite"));
  assert.equal(await read(f, "Existing/music.rar"), "incoming");
  assert.equal(await read(f, result.backups[0].backup + "/music.rar"), "previous");
  assert.ok(result.removedIds.includes(f.id("Existing/music.rar")));
  assert.equal(
    f.engine.poll(f.job.id).entries.find((item) => item.id === f.id("Old/music.rar")).relative,
    "Existing/music.rar",
  );
}
{
  const f = await fixture("Changed");
  const preview = await f.engine.rename(f.job.id, f.plans);
  await fs.writeFile(path.join(f.library, "Existing.rar"), "changed since the prompt");
  const result = await f.engine.rename(f.job.id, f.plans, choose(preview, "overwrite"));
  assert.match(result.error, /changed/);
  assert.equal(await read(f, "Old.rar"), "incoming");
  assert.equal(await read(f, "Free.rar"), "free");
  assert.equal(await read(f, "Existing.rar"), "changed since the prompt");
}
{
  const f = await fixture("Token");
  const preview = await f.engine.rename(f.job.id, f.plans);
  assert.match(
    (await f.engine.rename(f.job.id, f.plans, { token: "forged", policy: "overwrite" })).error,
    /expired/,
  );
  assert.equal(await read(f, "Existing.rar"), "previous");
  const again = await f.engine.rename(f.job.id, f.plans);
  assert.match(
    (
      await f.engine.rename(
        f.job.id,
        [{ id: f.id("Old.rar"), name: "Elsewhere.rar" }],
        choose(again, "overwrite"),
      )
    ).error,
    /expired/,
  );
  assert.equal(await read(f, "Old.rar"), "incoming");
  const expired = await f.engine.rename(f.job.id, f.plans);
  f.engine.jobs.get(f.job.id).pending.created -= 600001;
  assert.match(
    (await f.engine.rename(f.job.id, f.plans, choose(expired, "overwrite"))).error,
    /expired/,
  );
  assert.ok(preview.conflictToken);
}
{
  const f = await fixture("DuplicatePlans");
  const plans = [
    { id: f.id("Old.rar"), name: "Same.rar" },
    { id: f.id("Free.rar"), name: "Same.rar" },
  ];
  const preview = await f.engine.rename(f.job.id, plans);
  assert.equal(preview.conflicts[0].canOverwrite, false);
  const result = await f.engine.rename(f.job.id, plans, choose(preview, "overwrite"));
  assert.equal(result.renamed.length, 1);
  assert.equal(result.skipped.length, 1);
  assert.equal(await read(f, "Same.rar"), "incoming");
  assert.equal(await read(f, "Free.rar"), "free");
}
{
  const f = await fixture("SelectedDestination");
  const plans = [
    { id: f.id("Old.rar"), name: "Existing.rar" },
    { id: f.id("Existing.rar"), name: "Moved.rar" },
  ];
  const preview = await f.engine.rename(f.job.id, plans);
  assert.equal(preview.conflicts[0].canOverwrite, false);
  const result = await f.engine.rename(f.job.id, plans, choose(preview, "overwrite"));
  assert.equal(result.renamed.length, 1);
  assert.equal(await read(f, "Moved.rar"), "previous");
  assert.equal(await read(f, "Old.rar"), "incoming");
}
{
  const f = await fixture("Rollback");
  const preview = await f.engine.rename(f.job.id, f.plans);
  const rename = fs.rename;
  let failed = false;
  fs.rename = async (from, to) => {
    if (!failed && from === path.join(f.library, "Free.rar")) {
      failed = true;
      throw new Error("simulated NAS disconnection");
    }
    return rename(from, to);
  };
  let result;
  try {
    result = await f.engine.rename(f.job.id, f.plans, choose(preview, "overwrite"));
  } finally {
    fs.rename = rename;
  }
  assert.match(result.error, /disconnection/);
  assert.equal(result.renamed.length, 0);
  assert.equal(result.backups.length, 0);
  assert.equal(f.engine.pollSaveProgress(f.job.id).stage, "failed");
  assert.equal(f.engine.pollSaveProgress(f.job.id).renamed, 0);
  assert.equal(f.engine.pollSaveProgress(f.job.id).backups, 0);
  assert.equal(await read(f, "Old.rar"), "incoming");
  assert.equal(await read(f, "Existing.rar"), "previous");
  assert.equal(await read(f, "Free.rar"), "free");
}
console.log(
  "PASS: conflict choice before any writes, skip, recoverable archive/folder replacement, scoped/expired tokens, changed targets, duplicate/selected destinations, and NAS-error rollback. Only synthetic temporary fixtures changed.",
);
