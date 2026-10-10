import React, { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import type { NameEntry, NameConflict, NameSaveProgress } from "@/lib/folder-renames";
import {
  archiveBaseName as baseName,
  originalArchiveSuffix,
  replaceName as replace,
} from "@/lib/library-names";

export function LibraryNamesDialog({
  open,
  onOpenChange,
  onSaved,
  hasDirtyFiles,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<void>;
  hasDirtyFiles: boolean;
}) {
  const [job, setJob] = useState<{ id: string; name: string } | null>(null);
  const [entries, setEntries] = useState<NameEntry[]>([]);
  const [done, setDone] = useState(true),
    [saving, setSaving] = useState(false),
    [choosing, setChoosing] = useState(false);
  const [status, setStatus] = useState(
    "Choose a library folder. No songs or archive contents will be read.",
  );
  const [find, setFind] = useState(""),
    [replacement, setReplacement] = useState(""),
    [matchCase, setMatchCase] = useState(false);
  const [kind, setKind] = useState("all"),
    [selected, setSelected] = useState(new Set<string>());
  const [edits, setEdits] = useState<Record<string, string>>({}),
    [page, setPage] = useState(0);
  const [pending, setPending] = useState<{
    token: string;
    plans: { id: string; name: string }[];
    conflicts: NameConflict[];
  } | null>(null);
  const [saveReport, setSaveReport] = useState<string[]>([]);
  const [saveProgress, setSaveProgress] = useState<NameSaveProgress | null>(null);
  const [progressTime, setProgressTime] = useState(Date.now());
  const saveStartedAt = useRef(0);
  const locked = saving || Boolean(pending);
  const offset = useRef(0),
    activeJob = useRef<string | null>(null);
  const api = typeof window !== "undefined" ? window.tagMaestroDesktop : undefined;
  useEffect(() => {
    if (!saving || !job || !api) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const progress = await api.pollNameSaveProgress(job.id);
        if (cancelled) return;
        if (progress && progress.startedAt >= saveStartedAt.current) setSaveProgress(progress);
      } catch {
        /* A feedback read must never cancel an in-flight filesystem operation. */
      }
      if (!cancelled) {
        setProgressTime(Date.now());
        timer = setTimeout(poll, 350);
      }
    };
    void poll();
    const clock = setInterval(() => setProgressTime(Date.now()), 1000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearInterval(clock);
    };
  }, [saving, job, api]);
  useEffect(() => {
    if (!open || !job || done || !api) return;
    let cancelled = false,
      timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await api.pollNameLibrary(job.id, offset.current);
        if (cancelled) return;
        offset.current += result.entries.length;
        if (result.entries.length) setEntries((previous) => [...previous, ...result.entries]);
        setStatus(
          `${result.stopped ? "Stopped" : result.done ? "Listed" : "Listing"} ${result.total.toLocaleString()} folders / archives · ${result.visited.toLocaleString()} directory entries checked${result.ignored.length ? ` · Other files excluded: ${result.ignored.map((item) => `${item.extension} (${item.count})`).join(", ")}` : ""}${result.warningCount ? ` · ${result.warningCount} inaccessible/skipped locations: ${result.warnings.join("; ")}` : ""}`,
        );
        if (result.done && offset.current >= result.total) setDone(true);
        else timer = setTimeout(poll, offset.current < result.total ? 0 : 350);
      } catch (error) {
        if (!cancelled) {
          setDone(true);
          toast.error(String(error));
        }
      }
    };
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, job, done, api]);
  useEffect(
    () => () => {
      if (activeJob.current)
        void window.tagMaestroDesktop?.releaseNameLibrary(activeJob.current).catch(() => {});
    },
    [],
  );
  const proposed = (entry: NameEntry) => {
    const name = edits[entry.id] ?? replace(baseName(entry), find, replacement, matchCase);
    return name + originalArchiveSuffix(entry);
  };
  const filtered = useMemo(
    () =>
      entries.filter(
        (entry) =>
          (kind === "all" || kind === entry.kind) &&
          (!find ||
            (matchCase
              ? baseName(entry).includes(find)
              : baseName(entry).toLowerCase().includes(find.toLowerCase()))),
      ),
    [entries, kind, find, matchCase],
  );
  useEffect(() => setPage(0), [kind, find, matchCase]);
  const pages = Math.max(1, Math.ceil(filtered.length / 100));
  const currentPage = Math.min(page, pages - 1);
  const visible = filtered.slice(currentPage * 100, (currentPage + 1) * 100);
  const plans = entries
    .filter((entry) => selected.has(entry.id) && proposed(entry) !== entry.name)
    .map((entry) => ({ id: entry.id, name: proposed(entry) }));
  const allChecked = filtered.length > 0 && filtered.every((entry) => selected.has(entry.id));
  async function choose() {
    if (!api) return;
    setChoosing(true);
    try {
      const next = await api.chooseNameLibrary();
      if (!next) return;
      activeJob.current = next.id;
      offset.current = 0;
      setEntries([]);
      setSelected(new Set());
      setEdits({});
      setPending(null);
      setSaveReport([]);
      setSaveProgress(null);
      setPage(0);
      setDone(false);
      setJob(next);
    } catch (error) {
      toast.error(String(error));
    } finally {
      setChoosing(false);
    }
  }
  async function save(policy?: "skip" | "overwrite") {
    if (!api || !job || !plans.length || hasDirtyFiles) return;
    const requestedPlans = pending?.plans ?? plans;
    saveStartedAt.current = Date.now();
    setProgressTime(saveStartedAt.current);
    setSaveProgress({
      stage: policy ? "validating" : "preparing",
      total: requestedPlans.length,
      stageTotal: requestedPlans.length,
      processed: 0,
      renamed: 0,
      skipped: 0,
      conflicts: 0,
      backups: 0,
      current: "",
      startedAt: saveStartedAt.current,
      updatedAt: saveStartedAt.current,
    });
    setSaveReport([]);
    setSaving(true);
    try {
      const result = await api.renameLibraryNames(
        job.id,
        requestedPlans,
        policy && pending ? { token: pending.token, policy } : undefined,
      );
      const finalProgress = await api.pollNameSaveProgress(job.id).catch(() => null);
      if (finalProgress) setSaveProgress(finalProgress);
      setProgressTime(Date.now());
      if (result.conflictToken && result.conflicts?.length) {
        setPending({
          token: result.conflictToken,
          plans: requestedPlans,
          conflicts: result.conflicts,
        });
        return;
      }
      setPending(null);
      const report = [
        ...(result.skipped?.map(
          (item) => `Skipped: ${item.relative} → ${item.name} (${item.reason})`,
        ) ?? []),
        ...(result.backups?.map(
          (item) => `Replaced ${item.original}. Recovery backup: ${item.backup}`,
        ) ?? []),
      ];
      setSaveReport(report);
      if (result.removedIds?.length) {
        const removed = new Set(result.removedIds);
        setEntries((previous) => previous.filter((entry) => !removed.has(entry.id)));
      }
      if (result.renamed.length) {
        const changes = new Map(result.renamed.map((receipt) => [receipt.relative, receipt.name]));
        setEntries((previous) =>
          previous.map((entry) => {
            const parts = entry.relative.split("/");
            for (let count = 1; count <= parts.length; count++) {
              const name = changes.get(parts.slice(0, count).join("/"));
              if (name) {
                parts[count - 1] = name;
                break;
              }
            }
            return { ...entry, name: parts.at(-1)!, relative: parts.join("/") };
          }),
        );
        const savedIds = new Set(result.renamed.map((receipt) => receipt.id));
        setSelected((previous) => new Set([...previous].filter((id) => !savedIds.has(id))));
        setEdits((previous) =>
          Object.fromEntries(Object.entries(previous).filter(([id]) => !savedIds.has(id))),
        );
        // Keep skipped proposals available for a different name or a later save.
        if (!result.skipped?.length) {
          setFind("");
          setReplacement("");
        }
        toast.success(
          `Renamed ${result.renamed.length} originals${result.skipped?.length ? `; skipped ${result.skipped.length} conflicts` : ""}. No copying or tag edits.`,
        );
        await onSaved();
      }
      if (!result.renamed.length && result.skipped?.length)
        toast.info(`Skipped ${result.skipped.length} conflicts. No originals changed.`);
      if (!result.renamed.length && result.backups?.length) await onSaved();
      if (result.error) toast.error(result.error);
    } catch (error) {
      setSaveProgress((previous) =>
        previous ? { ...previous, stage: "failed", error: String(error) } : null,
      );
      toast.error(String(error));
    } finally {
      setSaving(false);
    }
  }
  const phaseLabels: Record<NameSaveProgress["stage"], string> = {
    preparing: "Checking names and conflicts",
    "awaiting-choice": "Waiting for your conflict choice",
    validating: "Checking items before saving",
    renaming: "Renaming originals",
    "rolling-back": "Restoring original names after an error",
    complete: "Save complete",
    failed: "Save stopped",
  };
  const phasePercent = saveProgress
    ? saveProgress.stage === "complete"
      ? 100
      : Math.min(
          100,
          Math.round((100 * saveProgress.processed) / Math.max(1, saveProgress.stageTotal)),
        )
    : 0;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (locked || choosing) return;
        if (!next && job) {
          void api?.releaseNameLibrary(job.id).catch(() => {});
          activeJob.current = null;
          setJob(null);
          setDone(true);
          setEntries([]);
          setSelected(new Set());
          setEdits({});
          setPending(null);
          setSaveReport([]);
          setSaveProgress(null);
          setStatus("Choose a library folder. No songs or archive contents will be read.");
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col p-5 gap-3 rounded-[4px]">
        <DialogHeader>
          <DialogTitle>Folder &amp; archive names · fast mode</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          Names only: ZIP, RAR, 7z and tar archives. No audio tags, cover images or extraction.
          Archive extension stays unchanged. Saving renames originals, never copies. Any loaded song
          table is cleared after a successful rename; reload it for fresh paths.
        </p>
        {!api && (
          <p className="text-sm text-amber-500">
            Open the desktop app for original folder / archive renaming. Browsers cannot rename
            library directories in place.
          </p>
        )}
        <div className="flex gap-2 items-center">
          <Button
            size="sm"
            disabled={!api || locked || choosing || !done}
            onClick={() => void choose()}
          >
            {choosing ? "Choosing…" : job ? "Choose another library" : "Choose library folder"}
          </Button>
          <span className="text-sm truncate">{job?.name}</span>
          {!done && (
            <Button size="sm" variant="outline" onClick={() => void api?.stopNameLibrary(job!.id)}>
              Stop listing
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground break-words" role="status">
          {status}
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <label className="text-xs">
            Show{" "}
            <select
              aria-label="Item type"
              className="bg-background border rounded-[4px] p-1"
              value={kind}
              disabled={locked}
              onChange={(event) => setKind(event.target.value)}
            >
              <option value="all">Folders &amp; archives</option>
              <option value="folder">Folders</option>
              <option value="archive">Archives (ZIP / RAR / 7z / tar)</option>
            </select>
          </label>
          <Input
            aria-label="Find in folder or archive name"
            placeholder="Find in name (literal text)"
            value={find}
            onChange={(event) => setFind(event.target.value)}
            className="h-8 flex-1 min-w-40"
            disabled={locked}
          />
          <Input
            aria-label="Replace with"
            placeholder="Replace with"
            value={replacement}
            onChange={(event) => setReplacement(event.target.value)}
            className="h-8 flex-1 min-w-40"
            disabled={locked}
          />
          <label className="text-xs flex gap-1 items-center">
            <input
              type="checkbox"
              checked={matchCase}
              disabled={locked}
              onChange={(event) => setMatchCase(event.target.checked)}
            />
            Match case
          </label>
        </div>
        <div className="overflow-auto min-h-0 border rounded-[4px]">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-background">
              <tr className="border-b">
                <th className="p-2">
                  <input
                    type="checkbox"
                    aria-label="Select all matching folders and archives"
                    checked={allChecked}
                    disabled={locked || !filtered.length}
                    onChange={() =>
                      setSelected((previous) => {
                        const next = new Set(previous);
                        for (const entry of filtered)
                          allChecked ? next.delete(entry.id) : next.add(entry.id);
                        return next;
                      })
                    }
                  />
                </th>
                <th className="text-left p-2">Type / current path</th>
                <th className="text-left p-2">New name (archive extension preserved)</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((entry) => (
                <tr key={entry.id} className="border-b">
                  <td className="p-2">
                    <input
                      type="checkbox"
                      aria-label={`Select ${entry.relative}`}
                      checked={selected.has(entry.id)}
                      disabled={locked}
                      onChange={(event) =>
                        setSelected((previous) => {
                          const next = new Set(previous);
                          event.target.checked ? next.add(entry.id) : next.delete(entry.id);
                          return next;
                        })
                      }
                    />
                  </td>
                  <td className="p-2 max-w-md break-all">
                    <span className="text-muted-foreground mr-2">
                      {entry.kind === "archive"
                        ? originalArchiveSuffix(entry).slice(1).toUpperCase()
                        : "Folder"}
                    </span>
                    {entry.relative}
                  </td>
                  <td className="p-1">
                    <Input
                      aria-label={`New name for ${entry.relative}`}
                      className="h-7 text-xs min-w-56"
                      value={
                        edits[entry.id] ?? replace(baseName(entry), find, replacement, matchCase)
                      }
                      disabled={locked}
                      onChange={(event) => {
                        setEdits((previous) => ({ ...previous, [entry.id]: event.target.value }));
                        setSelected((previous) => new Set(previous).add(entry.id));
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!entries.length && (
            <p className="p-6 text-sm text-muted-foreground">
              {done
                ? job
                  ? "No folders or supported archives found in this library. See excluded file types above."
                  : "Choose a library folder to load its folders and archives."
                : "Listing directory entries…"}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs">
          <Button
            size="sm"
            variant="outline"
            disabled={currentPage === 0 || locked}
            onClick={() => setPage(currentPage - 1)}
          >
            Previous
          </Button>
          <span>
            {filtered.length.toLocaleString()} matching · page {currentPage + 1}/{pages}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={currentPage + 1 >= pages || locked}
            onClick={() => setPage(currentPage + 1)}
          >
            Next
          </Button>
          <span className="ml-auto">{plans.length} changed, selected</span>
          <Button
            size="sm"
            disabled={!done || locked || !plans.length || hasDirtyFiles}
            onClick={() => void save()}
          >
            {saving ? "Saving…" : "Save original names"}
          </Button>
        </div>
        {saveProgress && (
          <section
            aria-label="Save progress"
            className="shrink-0 border rounded-[4px] p-3 space-y-1.5"
          >
            <div className="flex justify-between gap-2 text-xs" role="status">
              <span className="font-semibold">{phaseLabels[saveProgress.stage]}</span>
              <span>
                {saveProgress.processed.toLocaleString()} /{" "}
                {saveProgress.stageTotal.toLocaleString()}
                {saving &&
                  ` · ${Math.max(0, Math.floor((progressTime - saveProgress.startedAt) / 1000))}s elapsed`}
              </span>
            </div>
            <div
              role="progressbar"
              aria-label={phaseLabels[saveProgress.stage]}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={phasePercent}
              aria-valuetext={`${saveProgress.processed} of ${saveProgress.stageTotal} in this phase; ${saveProgress.renamed} renamed; ${saveProgress.skipped} skipped`}
              className="h-2 overflow-hidden rounded-[4px] bg-muted"
            >
              <div className="h-full bg-primary" style={{ width: `${phasePercent}%` }} />
            </div>
            <p className="text-xs" role="status">
              {saveProgress.renamed.toLocaleString()} of {saveProgress.total.toLocaleString()}{" "}
              renamed
              {" · "}
              {saveProgress.skipped.toLocaleString()} skipped
              {saveProgress.backups > 0 && ` · ${saveProgress.backups} recovery backups`}
              {saveProgress.stage === "awaiting-choice" && ` · ${saveProgress.conflicts} conflicts`}
              {saveProgress.stage === "failed" &&
                ` · ${Math.max(0, saveProgress.total - saveProgress.renamed - saveProgress.skipped)} not changed`}
            </p>
            {saveProgress.current && (
              <p className="text-xs text-muted-foreground truncate" title={saveProgress.current}>
                Current: {saveProgress.current}
              </p>
            )}
            {saving && progressTime - saveProgress.updatedAt > 5000 && (
              <p className="text-xs text-muted-foreground">
                Waiting for the drive or NAS to respond. Please keep the app open.
              </p>
            )}
            {saveProgress.error && (
              <p className="text-xs text-amber-500 break-words">{saveProgress.error}</p>
            )}
          </section>
        )}
        {pending && !saving && (
          <section
            role="alertdialog"
            aria-labelledby="name-conflicts-title"
            aria-describedby="name-conflicts-help"
            className="border border-amber-500 rounded-[4px] p-3 space-y-2"
          >
            <h3 id="name-conflicts-title" className="text-sm font-semibold">
              {pending.conflicts.length} conflicting names — what would you like to do?
            </h3>
            <p id="name-conflicts-help" className="text-xs text-muted-foreground">
              Skip keeps existing items unchanged and saves the other names. Overwrite replaces
              existing items, keeping them as hidden .tag-maestro-replaced-… backups in the same
              folder. Folders are replaced, not merged. Unsafe conflicts are always skipped.
            </p>
            <ul className="text-xs max-h-28 overflow-auto space-y-1">
              {pending.conflicts.map((item) => (
                <li key={item.id} className="break-all">
                  {item.relative} → {item.name}
                  {!item.canOverwrite && ` — ${item.reason}`}
                </li>
              ))}
            </ul>
            <div className="flex gap-2 flex-wrap">
              <Button size="sm" autoFocus disabled={saving} onClick={() => void save("skip")}>
                {saving ? "Saving…" : "Skip conflicting names"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={saving || !pending.conflicts.some((item) => item.canOverwrite)}
                onClick={() => void save("overwrite")}
              >
                Overwrite existing items
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={saving}
                onClick={() => {
                  setPending(null);
                  setSaveProgress(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </section>
        )}
        {saveReport.length > 0 && (
          <div role="status" className="text-xs max-h-24 overflow-auto border rounded-[4px] p-2">
            {saveReport.map((line, index) => (
              <p key={index} className="break-all">
                {line}
              </p>
            ))}
          </div>
        )}
        {hasDirtyFiles && (
          <p className="text-xs text-amber-500">
            Save or discard pending song edits before renaming here, so their original paths cannot
            become stale.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
