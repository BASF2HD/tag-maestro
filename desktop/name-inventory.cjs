const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { archiveSuffix } = require("../shared/archive-formats.mjs");
const {
  FolderRenames,
  folderName,
  same,
  exists,
  checkedDirectory,
} = require("./folder-renames.cjs");

// Only a native, user-chosen root grants access. IPC accepts opaque entry IDs, never paths.
class NameInventory {
  jobs = new Map();
  grants = new FolderRenames();
  async start(root) {
    const grant = await this.grants.grant(root);
    const scope = this.grants.roots.get(grant.token);
    this.grants.roots.delete(grant.token);
    const id = randomUUID();
    const job = {
      id,
      name: grant.name,
      scope,
      entries: [],
      byId: new Map(),
      done: false,
      stopped: false,
      saving: false,
      warnings: [],
      warningCount: 0,
      visited: 0,
      ignored: new Map(),
    };
    this.jobs.set(id, job);
    job.task = this.walk(job)
      .catch((error) => {
        job.warnings.push(String(error.message || error));
        job.warningCount++;
      })
      .finally(() => {
        job.done = true;
      });
    return { id, name: job.name };
  }
  async walk(job) {
    const queue = [""];
    for (let index = 0; index < queue.length && !job.stopped; index++) {
      const parent = queue[index];
      let directory;
      try {
        if (parent) await checkedDirectory(job.scope.root, parent);
        directory = await fs.opendir(path.join(job.scope.root, parent));
        for await (const child of directory) {
          if (job.stopped) break;
          job.visited++;
          // Replaced originals are recovery files, not new rename candidates.
          if (child.name.startsWith(".tag-maestro-replaced-")) continue;
          // Dirent type flags avoid a metadata/stat request for every music file on a NAS.
          if (child.isSymbolicLink()) continue;
          const kind = child.isDirectory()
            ? "folder"
            : child.isFile() && archiveSuffix(child.name)
              ? "archive"
              : null;
          if (!kind) {
            if (child.isFile()) {
              const extension = path.extname(child.name).toLowerCase() || "(no extension)";
              job.ignored.set(extension, (job.ignored.get(extension) || 0) + 1);
            }
            continue;
          }
          const relative = parent ? `${parent}/${child.name}` : child.name;
          if (job.entries.length >= 200000)
            throw new Error("Listing limit reached. Choose a smaller library folder.");
          const entry = { id: randomUUID(), relative, name: child.name, kind };
          job.entries.push(entry);
          job.byId.set(entry.id, entry);
          if (kind === "folder") queue.push(relative);
        }
      } catch (error) {
        job.warningCount++;
        if (job.warnings.length < 10)
          job.warnings.push(`${parent || job.name}: ${error.message || error}`);
        if (job.entries.length >= 200000) break;
      }
    }
  }
  poll(id, offset = 0) {
    const job = this.jobs.get(id);
    if (!job || !Number.isSafeInteger(offset) || offset < 0)
      throw new Error("Invalid library listing");
    return {
      entries: job.entries.slice(offset, offset + 1000),
      total: job.entries.length,
      visited: job.visited,
      done: job.done,
      stopped: job.stopped,
      warnings: job.warnings,
      warningCount: job.warningCount,
      ignored: [...job.ignored].map(([extension, count]) => ({ extension, count })),
    };
  }
  stop(id) {
    const job = this.jobs.get(id);
    if (job) job.stopped = true;
  }
  pollSaveProgress(id) {
    const job = this.jobs.get(id);
    if (!job) throw new Error("Invalid library listing");
    return job.saveProgress ? { ...job.saveProgress } : null;
  }
  progress(job, update) {
    Object.assign(job.saveProgress, update, { updatedAt: Date.now() });
  }
  async release(id) {
    const job = this.jobs.get(id);
    if (!job) return;
    if (job.saving) throw new Error("Wait for the current save to finish");
    job.stopped = true;
    await job.task;
    this.jobs.delete(id);
  }
  async check(job, entry) {
    if (!same(job.scope.stat, await fs.lstat(job.scope.root)))
      throw new Error("Library root changed");
    const parent = entry.relative.split("/").slice(0, -1).join("/");
    if (parent) await checkedDirectory(job.scope.root, parent);
    else if (!same(job.scope.stat, await fs.lstat(job.scope.root)))
      throw new Error("Library root changed");
    const source = path.join(job.scope.root, entry.relative);
    const stat = await fs.lstat(source);
    if (stat.isSymbolicLink() || (entry.kind === "folder" ? !stat.isDirectory() : !stat.isFile()))
      throw new Error("Listed item changed: " + entry.relative);
    return { source, stat };
  }
  async rename(id, plans, resolution) {
    const job = this.jobs.get(id);
    if (!job || !job.done || job.saving) throw new Error("Finish or stop listing before saving");
    if (!Array.isArray(plans) || !plans.length || plans.length > 10000)
      throw new Error("Choose between 1 and 10,000 changed items");
    job.saving = true;
    job.saveProgress = {
      stage: "preparing",
      total: plans.length,
      stageTotal: plans.length,
      processed: 0,
      renamed: 0,
      skipped: 0,
      conflicts: 0,
      backups: 0,
      current: "",
      startedAt: Date.now(),
      updatedAt: Date.now(),
    };
    const completed = [];
    const displaced = [];
    try {
      if (!same(job.scope.stat, await fs.lstat(job.scope.root)))
        throw new Error("Library root changed; choose it again");
      let records = [];
      const destinations = new Set(),
        sources = new Set();
      const signature = JSON.stringify(plans);
      if (resolution) {
        const pending = job.pending;
        job.pending = null;
        if (
          !pending ||
          pending.token !== resolution.token ||
          pending.signature !== signature ||
          Date.now() - pending.created > 600000 ||
          !["skip", "overwrite"].includes(resolution.policy)
        )
          throw new Error("Conflict choice expired; save again to review current conflicts");
        records = pending.records;
      } else {
        job.pending = null;
        for (const plan of plans) {
          const entry = job.byId.get(plan.id);
          if (!entry || sources.has(entry.relative))
            throw new Error("Invalid or duplicate listed item");
          this.progress(job, { current: entry.relative });
          sources.add(entry.relative);
          const name = folderName(plan.name);
          if (name === entry.name) throw new Error("An unchanged item was selected");
          if (
            entry.kind === "archive" &&
            archiveSuffix(name).toLowerCase() !== archiveSuffix(entry.name).toLowerCase()
          )
            throw new Error(
              "Archives must keep their original extension: " + archiveSuffix(entry.name),
            );
          const current = await this.check(job, entry);
          const destination = path.join(path.dirname(current.source), name);
          const target = await exists(destination);
          const duplicate = destinations.has(destination.toLowerCase());
          destinations.add(destination.toLowerCase());
          records.push({ entry, name, destination, target, duplicate, ...current });
          this.progress(job, { processed: records.length });
        }
        for (const record of records) {
          const parts = record.entry.relative.split("/");
          while (parts.length > 1) {
            parts.pop();
            if (sources.has(parts.join("/")))
              throw new Error("Rename parent folders and their contents in separate saves");
          }
        }
        const protectedSources = new Set();
        for (const record of records) {
          const parts = record.entry.relative.toLowerCase().split("/");
          while (parts.length) {
            protectedSources.add(parts.join("/"));
            parts.pop();
          }
        }
        for (const record of records) {
          const destinationRelative = path
            .relative(job.scope.root, record.destination)
            .split(path.sep)
            .join("/");
          const affectsSelected = protectedSources.has(destinationRelative.toLowerCase());
          record.conflict = Boolean(record.target || record.duplicate);
          record.canOverwrite = Boolean(
            record.target &&
            !record.duplicate &&
            !affectsSelected &&
            !record.target.isSymbolicLink() &&
            !same(record.target, record.stat) &&
            (record.entry.kind === "folder" ? record.target.isDirectory() : record.target.isFile()),
          );
          record.destinationRelative = destinationRelative;
          record.reason = record.duplicate
            ? "Two selected items request the same name; only the first can be saved."
            : record.target && same(record.target, record.stat)
              ? "Case-only rename: use a temporary name first."
              : affectsSelected
                ? "Destination contains another selected item; overwrite is unsafe."
                : record.target && !record.canOverwrite
                  ? "Destination has a different type or is a symbolic link."
                  : "Name already exists.";
        }
        const conflicts = records.filter((record) => record.conflict);
        if (conflicts.length) {
          const token = randomUUID();
          job.pending = { token, signature, records, created: Date.now() };
          this.progress(job, {
            stage: "awaiting-choice",
            conflicts: conflicts.length,
            current: "",
          });
          return {
            renamed: [],
            conflictToken: token,
            conflicts: conflicts.map((record) => ({
              id: record.entry.id,
              relative: record.entry.relative,
              name: record.name,
              canOverwrite: record.canOverwrite,
              reason: record.reason,
            })),
          };
        }
      }
      const skipped = records
        .filter(
          (record) => record.conflict && (resolution?.policy === "skip" || !record.canOverwrite),
        )
        .map((record) => ({
          id: record.entry.id,
          relative: record.entry.relative,
          name: record.name,
          reason: record.reason,
        }));
      const skippedIds = new Set(skipped.map((item) => item.id));
      records = records.filter((record) => !skippedIds.has(record.entry.id));
      this.progress(job, {
        stage: "validating",
        processed: 0,
        stageTotal: records.length,
        skipped: skipped.length,
        conflicts: records.filter((record) => record.conflict).length + skipped.length,
        current: "",
      });
      const validate = async (record) => {
        const current = await this.check(job, record.entry);
        const target = await exists(record.destination);
        if (
          !same(current.stat, record.stat) ||
          current.stat.mtimeMs !== record.stat.mtimeMs ||
          current.stat.size !== record.stat.size ||
          (record.target
            ? !target ||
              !same(target, record.target) ||
              target.mtimeMs !== record.target.mtimeMs ||
              target.size !== record.target.size ||
              target.isSymbolicLink()
            : target)
        )
          throw new Error(
            "Item or destination changed; save again to review: " + record.entry.relative,
          );
      };
      // Validate every target before the first mutation; never read archive/music contents.
      for (const record of records) {
        this.progress(job, { current: record.entry.relative });
        await validate(record);
        this.progress(job, { processed: job.saveProgress.processed + 1 });
      }
      this.progress(job, { stage: "renaming", processed: 0, current: "" });
      for (const record of records) {
        this.progress(job, { current: record.entry.relative + " → " + record.name });
        await validate(record);
        if (record.target) {
          record.backup = path.join(
            path.dirname(record.destination),
            ".tag-maestro-replaced-" + randomUUID() + archiveSuffix(record.name),
          );
          if (await exists(record.backup)) throw new Error("Recovery name already exists");
          await fs.rename(record.destination, record.backup);
          displaced.push(record);
          this.progress(job, { backups: displaced.length });
        }
        // Do not replace an unexpected item created after validation.
        if (await exists(record.destination)) throw new Error("Destination appeared while saving");
        await fs.rename(record.source, record.destination);
        completed.push(record);
        this.progress(job, { processed: completed.length, renamed: completed.length });
      }
      const removedIds = this.removeReplacedEntries(job, displaced);
      this.progress(job, { stage: "complete", current: "" });
      return {
        renamed: this.applyReceipts(job, completed),
        skipped,
        removedIds,
        backups: this.backupReceipts(job, displaced),
      };
    } catch (error) {
      this.progress(job, {
        stage: "rolling-back",
        processed: 0,
        stageTotal: completed.length + displaced.length,
        current: "",
        error: String(error.message || error),
      });
      const remaining = [];
      for (const record of completed.reverse()) {
        this.progress(job, { current: record.entry.relative });
        try {
          if (
            (await exists(record.source)) ||
            !same(record.stat, await fs.lstat(record.destination))
          )
            throw new Error("Cannot safely roll back");
          await fs.rename(record.destination, record.source);
          this.progress(job, { renamed: job.saveProgress.renamed - 1 });
        } catch {
          remaining.push(record);
        }
        this.progress(job, { processed: job.saveProgress.processed + 1 });
      }
      const retainedBackups = [];
      for (const record of displaced.reverse()) {
        this.progress(job, { current: record.destinationRelative });
        try {
          if (
            (await exists(record.destination)) ||
            !same(record.target, await fs.lstat(record.backup))
          )
            throw new Error("Cannot safely restore replaced item");
          await fs.rename(record.backup, record.destination);
          this.progress(job, { backups: job.saveProgress.backups - 1 });
        } catch {
          retainedBackups.push(record);
        }
        this.progress(job, { processed: job.saveProgress.processed + 1 });
      }
      const removedIds = this.removeReplacedEntries(job, retainedBackups);
      this.progress(job, {
        stage: "failed",
        renamed: remaining.length,
        backups: retainedBackups.length,
        current: "",
      });
      return {
        renamed: this.applyReceipts(job, remaining),
        removedIds,
        backups: this.backupReceipts(job, retainedBackups),
        error: String(error.message || error),
      };
    } finally {
      job.saving = false;
    }
  }
  backupReceipts(job, records) {
    return records.map((record) => ({
      original: record.destinationRelative,
      backup: path.relative(job.scope.root, record.backup).split(path.sep).join("/"),
    }));
  }
  removeReplacedEntries(job, records) {
    const replacedPaths = new Set(records.map((record) => record.destinationRelative));
    const removed = job.entries.filter((entry) => {
      const parts = entry.relative.split("/");
      while (parts.length) {
        if (replacedPaths.has(parts.join("/"))) return true;
        parts.pop();
      }
      return false;
    });
    const ids = new Set(removed.map((entry) => entry.id));
    job.entries = job.entries.filter((entry) => !ids.has(entry.id));
    for (const id of ids) job.byId.delete(id);
    return [...ids];
  }
  applyReceipts(job, records) {
    const receipts = records.map((record) => ({
      id: record.entry.id,
      relative: record.entry.relative,
      name: record.name,
    }));
    const changes = new Map(receipts.map((receipt) => [receipt.relative, receipt.name]));
    for (const entry of job.entries) {
      const parts = entry.relative.split("/");
      for (let count = 1; count <= parts.length; count++) {
        const replacement = changes.get(parts.slice(0, count).join("/"));
        if (replacement) {
          parts[count - 1] = replacement;
          break;
        }
      }
      entry.relative = parts.join("/");
      entry.name = parts.at(-1);
    }
    return receipts;
  }
}
module.exports = { NameInventory };
