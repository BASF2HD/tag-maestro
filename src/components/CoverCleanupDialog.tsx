import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Image as ImageIcon, Download, Upload, Save, Loader2 } from "@/components/icons";
import { type Mp3File, type Mp3Tags } from "@/lib/mp3";
import {
  DEFAULT_WATERMARKS,
  groupCoverJobs,
  sourceCover,
  exportCoverBatch,
  importCoverBatch,
  normalizeCover,
  readReview,
  reviewSummaries,
  storeReview,
  setReviewApprovals,
  saveReviewedAlbum,
  type ReviewEdit,
  type ReviewSummary,
} from "@/lib/cover-cleanup";
import { BATCH_SIZES, savedCoverBatchSize } from "@/lib/cover-batch-settings";

function useBlobUrl(blob?: Blob) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!blob) {
      setUrl(undefined);
      return;
    }
    const url = URL.createObjectURL(blob);
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (!cancelled) setUrl(url);
    };
    image.onerror = () => {
      if (!cancelled) setUrl(undefined);
    };
    image.src = url;
    return () => {
      cancelled = true;
      URL.revokeObjectURL(url);
    };
  }, [blob]);
  return url;
}
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  files: Mp3File[];
  onTrackSaved?: (row: Mp3File, file: File, cover: NonNullable<Mp3Tags["cover"]>) => void;
  onTracksSaved?: (tracks: SavedArtworkTrack[]) => void;
};
export type SavedArtworkTrack = { row: Mp3File; file: File; cover: NonNullable<Mp3Tags["cover"]> };
export function CoverCleanupDialog({
  open,
  onOpenChange,
  files,
  onTrackSaved,
  onTracksSaved,
}: Props) {
  const jobs = useMemo(() => groupCoverJobs(files), [files]);
  const jobsById = useMemo(() => new Map(jobs.map((source) => [source.id, source])), [jobs]);
  const [selected, setSelected] = useState(new Set<string>());
  const [active, setActive] = useState("");
  const [summaries, setSummaries] = useState<Record<string, ReviewSummary>>({});
  const [edit, setEdit] = useState<ReviewEdit>();
  const [original, setOriginal] = useState<Blob>();
  const [watermarks, setWatermarks] = useState(DEFAULT_WATERMARKS);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(0);
  const [revision, setRevision] = useState(0);
  const [batchSize, setBatchSize] = useState(savedCoverBatchSize);
  useEffect(() => {
    try {
      window.localStorage.setItem("coverCleanupBatchSize", String(batchSize));
    } catch {
      /* Storage is optional. */
    }
  }, [batchSize]);
  const batchInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const approvalInput = useRef<HTMLInputElement>(null);
  const wasOpen = useRef(false);
  const job = jobsById.get(active);
  const currentJob = useRef(job);
  currentJob.current = job;
  const displayedAlbum = useRef("");
  const previewFingerprint = job?.fingerprint;
  const filtered = useMemo(
    () =>
      jobs.filter((item) =>
        `${item.album} ${item.path}`.toLowerCase().includes(filter.toLowerCase()),
      ),
    [jobs, filter],
  );
  const shown = filtered.slice(page * batchSize, (page + 1) * batchSize);
  const beforeUrl = useBlobUrl(original);
  const afterUrl = useBlobUrl(edit?.image);
  const eligible = useCallback(
    (id: string) => {
      const summary = summaries[id],
        source = jobsById.get(id);
      return (
        summary &&
        source &&
        summary.fingerprint === source.fingerprint &&
        summary.approved &&
        !summary.saved
      );
    },
    [summaries, jobsById],
  );
  const approved = useMemo(() => [...selected].filter(eligible), [selected, eligible]);
  const reviewable = useMemo(
    () =>
      jobs.filter((source) => {
        const summary = summaries[source.id];
        return summary && summary.fingerprint === source.fingerprint && !summary.saved;
      }),
    [jobs, summaries],
  );
  const approvalCount = reviewable.filter((source) => summaries[source.id].approved).length;
  const savedCount = jobs.filter(
    (source) =>
      summaries[source.id]?.saved && summaries[source.id].fingerprint === source.fingerprint,
  ).length;
  const allApproved = reviewable.length > 0 && approvalCount === reviewable.length;
  const partiallyApproved = approvalCount > 0 && !allApproved;
  useEffect(() => {
    if (approvalInput.current) approvalInput.current.indeterminate = partiallyApproved;
  }, [partiallyApproved, open]);

  useEffect(() => {
    if (open && !wasOpen.current) {
      setSelected(new Set(jobs.slice(0, batchSize).map((item) => item.id)));
      setActive(jobs[0]?.id || "");
      setPage(0);
      setFilter("");
      setError("");
      setImportWarnings([]);
      setMessage("");
      void reviewSummaries()
        .then((items) => setSummaries(Object.fromEntries(items.map((item) => [item.id, item]))))
        .catch((error) => setError(String(error)));
    }
    wasOpen.current = open;
  }, [open, jobs, batchSize]);
  useEffect(() => {
    const source = currentJob.current;
    if (!open || !source || busy) return;
    let cancelled = false;
    // Updating another track/album must never blank the current cover previews.
    if (displayedAlbum.current !== source.id) {
      displayedAlbum.current = source.id;
      setEdit(undefined);
      setOriginal(undefined);
    }
    void (async () => {
      const saved = await readReview(source.id);
      if (saved && saved.fingerprint === source.fingerprint) {
        if (!cancelled) {
          setEdit(saved);
          setOriginal(saved.sourceImage);
        }
      } else {
        const cover = await sourceCover(source);
        if (!cancelled) {
          setEdit(undefined);
          setOriginal(new Blob([new Uint8Array(cover.data)], { type: cover.mime }));
        }
      }
    })().catch((error) => {
      if (!cancelled) setError(String(error instanceof Error ? error.message : error));
    });
    return () => {
      cancelled = true;
    };
  }, [open, active, previewFingerprint, revision, busy]);
  if (!open) return null;

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setImportWarnings([]);
    try {
      await action();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    const items = await reviewSummaries();
    setSummaries(Object.fromEntries(items.map((item) => [item.id, item])));
    setRevision((value) => value + 1);
  }
  async function saveAlbums(ids: string[]) {
    let count = 0;
    const completed: SavedArtworkTrack[] = [];
    try {
      for (const id of ids) {
        const source = jobsById.get(id);
        const record = await readReview(id);
        if (!source || !record) throw new Error("Reviewed cover missing");
        await saveReviewedAlbum(
          source,
          record,
          (row, saved, cover) => {
            completed.push({ row, file: saved, cover });
            count++;
          },
          setMessage,
        );
      }
      setMessage(
        `Saved and read-back verified artwork in ${count} original ${count === 1 ? "song" : "songs"}. No audio encoding performed.`,
      );
    } finally {
      // One library update, including verified partial saves if a later write fails.
      if (completed.length) {
        if (onTracksSaved) onTracksSaved(completed);
        else completed.forEach(({ row, file, cover }) => onTrackSaved?.(row, file, cover));
      }
      await refresh();
    }
  }
  const toggle = (id: string) =>
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  function status(id: string, fingerprint: string) {
    const item = summaries[id];
    if (!item) return "Awaiting edit";
    if (item.fingerprint !== fingerprint) return "Source changed";
    return item.saved ? "Saved ✓" : item.approved ? "Approved — not saved" : "Needs review";
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!busy) onOpenChange(value);
      }}
    >
      <DialogContent className="flex max-h-[92vh] max-w-6xl flex-col rounded-[4px] p-5">
        <DialogHeader className="pr-8">
          <DialogTitle>Codex cover cleanup</DialogTitle>
        </DialogHeader>
        <p className="mt-2 text-xs text-muted-foreground">
          1. Export a batch → 2. Edit in Codex → 3. Import, review and save. No automatic AI calls
          or API key. Only artwork is saved; audio, text tags and filenames stay unchanged.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !selected.size || selected.size > batchSize}
            onClick={() =>
              void run(async () => {
                const batch = jobs.filter((item) => selected.has(item.id));
                download(
                  await exportCoverBatch(batch, watermarks, setMessage),
                  `tagmaestro-codex-${Date.now()}.zip`,
                );
                setMessage(
                  `Exported ${batch.length} albums. Extract the ZIP in Codex and use CODEX-PROMPT.md.`,
                );
              })
            }
          >
            <Download className="mr-1 h-4 w-4" />
            Export {selected.size} for Codex
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => batchInput.current?.click()}
          >
            <Upload className="mr-1 h-4 w-4" />
            Import edited ZIP
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !job}
            onClick={() => imageInput.current?.click()}
          >
            <ImageIcon className="mr-1 h-4 w-4" />
            Assign image to this album
          </Button>
          <Button
            size="sm"
            disabled={busy || !approved.length}
            onClick={() => void run(() => saveAlbums(approved))}
          >
            <Save className="mr-1 h-4 w-4" />
            Save {approved.length} approved albums
          </Button>
          <input
            ref={batchInput}
            className="hidden"
            type="file"
            accept=".zip"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file)
                void run(async () => {
                  const imported = await importCoverBatch(
                    file,
                    jobs,
                    setMessage,
                    setImportWarnings,
                  );
                  await refresh();
                  setActive(imported[0].id);
                  setSelected(new Set(imported.map((item) => item.id)));
                  setMessage(`Imported ${imported.length} covers. Review each before approval.`);
                });
            }}
          />
          <input
            ref={imageInput}
            className="hidden"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file && job)
                void run(async () => {
                  const cover = await sourceCover(job);
                  await storeReview({
                    id: job.id,
                    fingerprint: job.fingerprint,
                    image: await normalizeCover(file),
                    sourceImage: new Blob([new Uint8Array(cover.data)], { type: cover.mime }),
                    approved: false,
                    saved: false,
                  });
                  await refresh();
                  setMessage(
                    `Assigned ${file.name} to ${job.album}. Check the comparison, then approve.`,
                  );
                });
            }}
          />
        </div>
        <div className="mt-3 rounded-[4px] border border-border px-3 py-2">
          <label className="flex items-center gap-2 text-xs">
            <input
              ref={approvalInput}
              type="checkbox"
              aria-label="Approve all imported artwork"
              aria-checked={partiallyApproved ? "mixed" : allApproved}
              checked={allApproved}
              disabled={busy || !reviewable.length}
              onChange={(event) => {
                const approve = event.target.checked;
                void run(async () => {
                  const updated = await setReviewApprovals(reviewable, approve);
                  if (approve)
                    setSelected(
                      (previous) =>
                        new Set([...previous, ...reviewable.map((source) => source.id)]),
                    );
                  await refresh();
                  setMessage(
                    `${approve ? "Approved" : "Removed approval from"} ${updated} imported ${updated === 1 ? "album" : "albums"}. Originals are unchanged until you press Save.`,
                  );
                });
              }}
            />
            <span>
              Approve all imported artwork ({approvalCount}/{reviewable.length} albums)
            </span>
          </label>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Includes imported edits on every page, not just this filter. Check covers before
            approving. Missing, changed and already-saved artwork is excluded. Individual approval
            still works below.
          </p>
          {!reviewable.length && savedCount > 0 && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              {savedCount} albums are already saved. Re-import the edited ZIP to review and approve
              them again. Successful re-import clears their saved status; it does not write music
              files.
            </p>
          )}
        </div>
        <label className="mt-3 flex items-center gap-2 text-xs">
          Albums per batch
          <select
            aria-label="Albums per batch"
            className="h-7 rounded-[4px] border border-input bg-background px-2 text-xs"
            value={batchSize}
            disabled={busy}
            onChange={(event) => {
              setBatchSize(Number(event.target.value));
              setPage(0);
            }}
          >
            {BATCH_SIZES.map((size) => (
              <option key={size} value={size}>
                {size} albums
              </option>
            ))}
          </select>
          <span className="text-muted-foreground">
            Export limit and albums per page. Choose Select this page to include more.
          </span>
        </label>
        <label className="mt-3 flex items-center gap-2 text-xs">
          Watermarks to remove only when clearly identified
          <Input
            aria-label="Watermark text"
            className="h-7 max-w-md text-xs"
            value={watermarks}
            disabled={busy}
            onChange={(event) => setWatermarks(event.target.value)}
          />
        </label>
        <div
          className="mt-3 flex h-10 shrink-0 items-start gap-1 overflow-hidden text-xs"
          role="status"
        >
          <span className="inline-block w-4 shrink-0">
            {busy && <Loader2 className="h-3 w-3 animate-spin" />}
          </span>
          <span className="line-clamp-2 min-w-0" title={message}>
            {message}
          </span>
        </div>
        {error && (
          <p className="whitespace-pre-wrap text-xs text-destructive" role="alert">
            {error}
          </p>
        )}
        {importWarnings.length > 0 && (
          <div
            className="max-h-24 overflow-auto rounded-[4px] border border-amber-500 p-2 text-xs"
            role="alert"
          >
            <p className="font-medium">
              Imported unchanged albums. These albums were safely skipped:
            </p>
            {importWarnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
          </div>
        )}
        <div className="mt-4 grid min-h-0 flex-1 gap-4 overflow-y-auto md:grid-cols-[minmax(250px,0.8fr)_minmax(0,1.6fr)]">
          <section className="min-h-0 rounded-[4px] border border-border p-3">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span>
                {jobs.length} albums · {files.length} songs
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => setSelected(new Set(shown.map((item) => item.id)))}
              >
                Select this page
              </Button>
            </div>
            <Input
              aria-label="Filter cover albums"
              placeholder="Find album or folder…"
              className="my-2 h-7 text-xs"
              value={filter}
              onChange={(event) => {
                setFilter(event.target.value);
                setPage(0);
              }}
            />
            <div className="max-h-[46vh] overflow-auto">
              {shown.map((item) => (
                <div
                  key={item.id}
                  className={`flex items-center gap-2 border-b border-border px-1 py-1.5 ${item.id === active ? "bg-accent" : ""}`}
                >
                  <input
                    type="checkbox"
                    aria-label={`Select ${item.album} (${item.path})`}
                    checked={selected.has(item.id)}
                    disabled={busy}
                    onChange={() => toggle(item.id)}
                  />
                  <button
                    disabled={busy}
                    className="min-w-0 flex-1 text-left text-xs"
                    onClick={() => {
                      setActive(item.id);
                      setError("");
                    }}
                    title={item.path}
                  >
                    <span className="block truncate font-medium">
                      {item.album} {item.year && `· ${item.year}`}
                    </span>
                    <span className="block truncate text-[10px] text-muted-foreground">
                      {item.path || "Added files"} · {item.files.length} songs ·{" "}
                      {status(item.id, item.fingerprint)}
                    </span>
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-2 flex items-center justify-between text-xs">
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || !page}
                onClick={() => setPage((value) => value - 1)}
              >
                Previous
              </Button>
              <span>
                {page + 1} / {Math.max(1, Math.ceil(filtered.length / batchSize))}
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || (page + 1) * batchSize >= filtered.length}
                onClick={() => setPage((value) => value + 1)}
              >
                Next
              </Button>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Up to {batchSize} albums per export (512 MB maximum). Edits and review status are
              retained locally in this browser. Nothing writes automatically.
            </p>
          </section>
          <section className="min-w-0 rounded-[4px] border border-border p-3">
            <h3 className="truncate text-sm font-medium">
              {job?.album || "Choose an album"}
              {job?.year && ` | ${job.year}`}
            </h3>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <figure>
                <div className="grid aspect-square place-items-center overflow-hidden rounded-[4px] bg-black/10">
                  {beforeUrl ? (
                    <img
                      className="h-full w-full object-contain"
                      alt="Original album artwork"
                      src={beforeUrl}
                    />
                  ) : (
                    <span className="text-xs text-muted-foreground">Loading original…</span>
                  )}
                </div>
                <figcaption className="mt-1 text-xs text-muted-foreground">Original</figcaption>
              </figure>
              <figure>
                <div className="grid aspect-square place-items-center overflow-hidden rounded-[4px] bg-black/10">
                  {afterUrl ? (
                    <img
                      className="h-full w-full object-contain"
                      alt="Edited album artwork"
                      src={afterUrl}
                    />
                  ) : (
                    <span className="px-4 text-center text-xs text-muted-foreground">
                      Import a Codex edit to compare
                    </span>
                  )}
                </div>
                <figcaption className="mt-1 text-xs text-muted-foreground">
                  Edited · 500 × 500 JPEG
                </figcaption>
              </figure>
            </div>
            <label className="mt-4 flex items-start gap-2 text-xs">
              <input
                type="checkbox"
                className="mt-0.5"
                disabled={busy || !edit || edit.saved}
                checked={edit?.approved || false}
                onChange={(event) => {
                  if (!edit) return;
                  const approved = event.target.checked;
                  void run(async () => {
                    await storeReview({ ...edit, approved });
                    await refresh();
                  });
                }}
              />
              <span>
                I checked this cover: correct album, faces, lettering and record-label logos.
                Approve artwork replacement in all {job?.files.length || 0} songs in this album.
              </span>
            </label>
            <div className="mt-3 flex items-center gap-3">
              <Button
                size="sm"
                disabled={busy || !job || !eligible(job.id)}
                onClick={() => {
                  if (job) void run(() => saveAlbums([job.id]));
                }}
              >
                <Save className="mr-1 h-4 w-4" />
                Save this album to originals
              </Button>
              <span className="text-[11px] text-muted-foreground">
                {edit?.saved
                  ? "Original files saved and verified."
                  : "Approval alone does not save files."}
              </span>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              AI can redraw fine lettering. Reject imperfect edits. Direct saving requires folder
              write access in Chrome or Edge. Other unsaved tag edits are not applied. Loose cover
              files are not changed. Only approved albums you choose to save are written.
            </p>
          </section>
        </div>
        {selected.size > batchSize && (
          <p className="text-xs text-destructive">
            Increase Albums per batch or choose at most {batchSize} albums before exporting.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
