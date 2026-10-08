import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Image as ImageIcon, Download, Upload, Save, Loader2 } from "@/components/icons";
import { type Mp3File, type Mp3Tags } from "@/lib/mp3";
import {
  DEFAULT_WATERMARKS,
  MAX_BATCH,
  groupCoverJobs,
  sourceCover,
  exportCoverBatch,
  importCoverBatch,
  normalizeCover,
  readReview,
  reviewSummaries,
  storeReview,
  saveReviewedAlbum,
  type ReviewEdit,
  type ReviewSummary,
} from "@/lib/cover-cleanup";

function useBlobUrl(blob?: Blob) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!blob) {
      setUrl(undefined);
      return;
    }
    const url = URL.createObjectURL(blob);
    setUrl(url);
    return () => URL.revokeObjectURL(url);
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
  onTrackSaved: (row: Mp3File, file: File, cover: NonNullable<Mp3Tags["cover"]>) => void;
};
export function CoverCleanupDialog({ open, onOpenChange, files, onTrackSaved }: Props) {
  const jobs = useMemo(() => groupCoverJobs(files), [files]);
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
  const batchInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const wasOpen = useRef(false);
  const job = jobs.find((item) => item.id === active);
  const filtered = jobs.filter((item) =>
    `${item.album} ${item.path}`.toLowerCase().includes(filter.toLowerCase()),
  );
  const shown = filtered.slice(page * MAX_BATCH, (page + 1) * MAX_BATCH);
  const beforeUrl = useBlobUrl(original);
  const afterUrl = useBlobUrl(edit?.image);
  const eligible = (id: string) => {
    const summary = summaries[id],
      source = jobs.find((item) => item.id === id);
    return (
      summary &&
      source &&
      summary.fingerprint === source.fingerprint &&
      summary.approved &&
      !summary.saved
    );
  };
  const approved = [...selected].filter(eligible);

  useEffect(() => {
    if (open && !wasOpen.current) {
      setSelected(new Set(jobs.slice(0, MAX_BATCH).map((item) => item.id)));
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
  }, [open, jobs]);
  useEffect(() => {
    if (!open || !job) return;
    let cancelled = false;
    setEdit(undefined);
    setOriginal(undefined);
    void (async () => {
      const saved = await readReview(job.id);
      if (saved && saved.fingerprint === job.fingerprint) {
        if (!cancelled) {
          setEdit(saved);
          setOriginal(saved.sourceImage);
        }
      } else {
        const cover = await sourceCover(job);
        if (!cancelled) setOriginal(new Blob([new Uint8Array(cover.data)], { type: cover.mime }));
      }
    })().catch((error) => {
      if (!cancelled) setError(String(error instanceof Error ? error.message : error));
    });
    return () => {
      cancelled = true;
    };
  }, [open, job, revision]);
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
    return item.saved ? "Saved ✓" : item.approved ? "Approved" : "Needs review";
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
          <DialogTitle>Codex-assisted cover cleanup</DialogTitle>
        </DialogHeader>
        <p className="mt-2 text-xs text-muted-foreground">
          1. Export a batch → 2. Edit in Codex → 3. Import, review and save. No automatic AI calls
          or API key. Only artwork is saved; audio, text tags and filenames stay unchanged.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !selected.size || selected.size > MAX_BATCH}
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
            onClick={() =>
              void run(async () => {
                let count = 0;
                for (const id of approved) {
                  const job = jobs.find((item) => item.id === id)!;
                  const record = await readReview(id);
                  if (!record) throw new Error("Reviewed cover missing");
                  await saveReviewedAlbum(
                    job,
                    record,
                    (row, saved, cover) => {
                      onTrackSaved(row, saved, cover);
                      count++;
                    },
                    setMessage,
                  );
                }
                await refresh();
                setMessage(
                  `Saved and read-back verified artwork in ${count} songs. No audio encoding performed.`,
                );
              })
            }
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
        <div className="mt-3 min-h-5 text-xs" role="status">
          {busy && <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />}
          {message}
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
                {page + 1} / {Math.max(1, Math.ceil(filtered.length / MAX_BATCH))}
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || (page + 1) * MAX_BATCH >= filtered.length}
                onClick={() => setPage((value) => value + 1)}
              >
                Next
              </Button>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Up to 25 albums per export. Edits and review status are retained locally in this
              browser. Nothing writes automatically.
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
            <p className="mt-2 text-[11px] text-muted-foreground">
              AI can redraw fine lettering. Reject imperfect edits. Direct saving requires folder
              write access in Chrome or Edge. Other unsaved tag edits are not applied. Loose cover
              files are not changed. Only approved, selected album folders are written.
            </p>
          </section>
        </div>
        {selected.size > MAX_BATCH && (
          <p className="text-xs text-destructive">
            Choose at most {MAX_BATCH} albums before exporting.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
