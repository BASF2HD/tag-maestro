import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CoverArtImage } from "@/components/CoverArtImage";
import { Button } from "@/components/ui/button";
import { albumGroups } from "@/lib/album-groups";
import {
  loadFolderCover,
  replaceAlbumCovers,
  scanAlbumCover,
  type CoverReceipt,
  type CoverScan,
} from "@/lib/album-covers";
import type { Mp3File } from "@/lib/mp3";

export function AlbumCoversDialog({
  open,
  onOpenChange,
  files,
  onSaved,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  files: Mp3File[];
  onSaved(receipt: CoverReceipt): void;
}) {
  const albums = useMemo(() => albumGroups(files), [files]);
  const [scans, setScans] = useState<CoverScan[]>([]);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState("");
  const cancel = useRef(false);
  useEffect(() => {
    if (open) {
      setScans([]);
      setChoices({});
      setStatuses({});
      setMessage("");
      setPreview("");
    }
  }, [open]);
  const currentRows = useMemo(() => new Map(files.map((file) => [file.id, file])), [files]);
  const jobs = scans.flatMap((scan) => {
    const candidate = scan.candidates.find((c) => c.name === choices[scan.album.id]);
    const refreshed = {
      ...scan,
      album: {
        ...scan.album,
        files: scan.album.files.map((row) => currentRows.get(row.id) || row),
      },
    };
    return candidate && !statuses[scan.album.id]?.startsWith("Saved")
      ? [{ scan: refreshed, candidate }]
      : [];
  });
  const scan = async () => {
    cancel.current = false;
    setRunning(true);
    setScans([]);
    setStatuses({});
    setChoices({});
    setPreview("");
    const result: CoverScan[] = [];
    const selected: Record<string, string> = {};
    try {
      for (const album of albums) {
        if (cancel.current) break;
        setMessage(`Scanning ${result.length + 1}/${albums.length}: ${album.name}`);
        const found = await scanAlbumCover(album);
        result.push(found);
        if (found.candidates.length === 1) selected[album.id] = found.candidates[0].name;
        if (result.length % 20 === 0) {
          setScans([...result]);
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }
      setScans(result);
      setChoices(selected);
      setMessage(
        `Scanned ${result.length} albums. Review the front images before replacing artwork.`,
      );
    } finally {
      setRunning(false);
    }
  };
  const save = async () => {
    cancel.current = false;
    setRunning(true);
    try {
      const result = await replaceAlbumCovers(jobs, {
        cancelled: () => cancel.current,
        progress: setMessage,
        saved: onSaved,
        failed: (id, error) =>
          setStatuses((previous) => ({ ...previous, [id]: `Error: ${error}` })),
        completed: (id) => setStatuses((previous) => ({ ...previous, [id]: "Saved and verified" })),
      });
      setMessage(
        `${cancel.current ? "Stopped. " : ""}${result.saved} tracks saved and verified; ${result.failed} failed. Completed tracks remain saved.`,
      );
      // Refresh successful receipts before a partial album is retried.
      setChoices({});
    } catch (error) {
      setMessage(String(error));
    } finally {
      setRunning(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!running) onOpenChange(value);
      }}
    >
      <DialogContent className="sm:max-w-4xl max-h-[90vh] flex flex-col overflow-hidden p-4 gap-3">
        <DialogHeader className="pr-8">
          <DialogTitle>Update covers from album folders</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          {albums.length} albums · {files.length} tracks in the current selection (all loaded files
          when nothing is selected). Looks for Front.jpg / _Front.jpg in Covers, then beside the
          songs. Multiple matches need a choice.
        </p>
        <p className="text-xs text-muted-foreground">
          Replaces the embedded front artwork and saves originals, preserving text tags and other
          picture types. Source images stay in place. Pending text edits remain unsaved; tracks with
          pending artwork edits are skipped.
        </p>
        <div className="flex gap-2">
          <Button size="sm" disabled={running} onClick={() => void scan()}>
            Scan folders
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={running || !scans.length}
            onClick={() =>
              setChoices(
                Object.fromEntries(
                  scans
                    .filter(
                      (s) =>
                        s.candidates.length === 1 && !statuses[s.album.id]?.startsWith("Saved"),
                    )
                    .map((s) => [s.album.id, s.candidates[0].name]),
                ),
              )
            }
          >
            Select unique matches
          </Button>
          <Button size="sm" variant="outline" disabled={running} onClick={() => setChoices({})}>
            Clear selection
          </Button>
        </div>
        <div className="flex min-h-0 flex-1 gap-3 overflow-hidden">
          <div className="min-h-[140px] flex-1 overflow-auto border rounded-md divide-y">
            {scans.map((scan) => (
              <div key={scan.album.id} className="p-2 space-y-1">
                <label className="flex gap-2 items-start text-xs">
                  <input
                    type="checkbox"
                    disabled={
                      running ||
                      scan.candidates.length !== 1 ||
                      statuses[scan.album.id]?.startsWith("Saved")
                    }
                    checked={Boolean(choices[scan.album.id])}
                    onChange={(event) =>
                      setChoices((previous) => ({
                        ...previous,
                        [scan.album.id]: event.target.checked ? scan.candidates[0].name : "",
                      }))
                    }
                  />
                  <span className="break-all">
                    {scan.album.name}{" "}
                    <span className="text-muted-foreground">
                      ({scan.album.files.length} tracks)
                    </span>
                  </span>
                </label>
                {scan.candidates.length > 0 && (
                  <div className="flex gap-2">
                    <select
                      aria-label={`Front image for ${scan.album.name}`}
                      className="min-w-0 flex-1 h-8 bg-background border rounded px-2 text-xs"
                      disabled={running || statuses[scan.album.id]?.startsWith("Saved")}
                      value={choices[scan.album.id] || ""}
                      onChange={(event) =>
                        setChoices((previous) => ({
                          ...previous,
                          [scan.album.id]: event.target.value,
                        }))
                      }
                    >
                      <option value="">Skip / choose front image</option>
                      {scan.candidates.map((c) => (
                        <option key={c.name} value={c.name}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={running || !choices[scan.album.id]}
                      onClick={async () => {
                        try {
                          const c = scan.candidates.find((c) => c.name === choices[scan.album.id])!;
                          setPreview((await loadFolderCover(c)).dataUrl);
                        } catch (error) {
                          setMessage(String(error));
                        }
                      }}
                    >
                      Preview
                    </Button>
                  </div>
                )}
                <p
                  className={`text-xs ${statuses[scan.album.id]?.startsWith("Error") ? "text-destructive" : "text-muted-foreground"}`}
                >
                  {statuses[scan.album.id] ||
                    scan.error ||
                    (scan.candidates.length > 1
                      ? "Multiple front images: choose one explicitly."
                      : scan.candidates[0]?.name)}
                </p>
              </div>
            ))}
            {!scans.length && (
              <p className="p-4 text-xs text-muted-foreground">
                Scan to find front covers without changing any music files.
              </p>
            )}
          </div>
          {preview && (
            <CoverArtImage
              src={preview}
              alt="Selected front image"
              className="w-48 h-48 object-contain max-sm:hidden"
            />
          )}
        </div>
        <p role="status" className="text-xs break-words">
          {message}
        </p>
        <div className="flex justify-end gap-2">
          {running ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                cancel.current = true;
                setMessage("Stopping after the current file…");
              }}
            >
              Stop
            </Button>
          ) : (
            <>
              <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              <Button size="sm" disabled={!jobs.length} onClick={() => void save()}>
                Replace front artwork &amp; save (
                {jobs.reduce((n, j) => n + j.scan.album.files.length, 0)} tracks)
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
