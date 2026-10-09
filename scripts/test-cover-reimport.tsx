// Synthetic PCM files and memory-only handles. No real music or filesystem writes.
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import JSZip from "jszip";
import { CoverCleanupDialog } from "../src/components/CoverCleanupDialog";
import { readMp3, writeCoverToBlob, type Mp3File } from "../src/lib/mp3";
import {
  blobCover,
  groupCoverJobs,
  exportCoverBatch,
  importCoverBatch,
  DEFAULT_WATERMARKS,
  readReview,
  storeReview,
  setReviewApprovals,
  saveReviewedAlbum,
  sha256,
} from "../src/lib/cover-cleanup";
import "../src/styles.css";
const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};
function pcm() {
  const bytes = new Uint8Array(172),
    view = new DataView(bytes.buffer),
    enc = new TextEncoder();
  bytes.set(enc.encode("RIFF"));
  view.setUint32(4, bytes.length - 8, true);
  bytes.set(enc.encode("WAVEfmt "), 8);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true);
  view.setUint32(28, 16000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  bytes.set(enc.encode("data"), 36);
  view.setUint32(40, 128, true);
  return bytes;
}
async function image(color: string) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 32;
  canvas.getContext("2d")!.fillStyle = color;
  canvas.getContext("2d")!.fillRect(0, 0, 32, 32);
  return new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob!), "image/png"));
}
async function runTests(progress: (message: string) => void) {
  const rows: Mp3File[] = [];
  const sources: { get: () => File; set: (file: File) => void }[] = [];
  for (const name of ["Test A", "Test B"]) {
    let current = new File(
      [
        await writeCoverToBlob(
          new File([pcm()], `${name}.wav`),
          await blobCover(await image("#c44")),
        ),
      ],
      `${name}.wav`,
      { lastModified: 1 },
    );
    sources.push({
      get: () => current,
      set: (file) => {
        current = file;
      },
    });
    const handle = {
      getFile: async () => current,
      queryPermission: async () => "granted",
      requestPermission: async () => "granted",
      createWritable: async () => {
        let pending: Blob;
        return {
          write: async (blob: Blob) => {
            await new Promise((resolve) => setTimeout(resolve, 80));
            pending = blob;
          },
          close: async () => {
            current = new File([pending], current.name, { lastModified: current.lastModified + 1 });
          },
          abort: async () => {},
        };
      },
    } as unknown as FileSystemFileHandle;
    const row = await readMp3(current, `Synthetic/${name}/${name}.wav`, true, true, handle);
    row.tags.album = row.original.album = name;
    row.tags.year = row.original.year = "2026";
    row.librarySourceId = "reimport-fixture";
    rows.push(row);
  }
  const jobs = groupCoverJobs(rows);
  const zip = await JSZip.loadAsync(
    await (await exportCoverBatch(jobs, DEFAULT_WATERMARKS, progress)).arrayBuffer(),
  );
  const edited = await image("#48a");
  for (const job of jobs) zip.file(`edited/${job.id}.png`, edited);
  const batch = new File([await zip.generateAsync({ type: "blob" })], "reviewed.zip");
  assert((await importCoverBatch(batch, jobs, progress)).length === 2, "Initial import failed");
  await setReviewApprovals(jobs, true);
  for (const job of jobs) {
    await saveReviewedAlbum(
      job,
      (await readReview(job.id))!,
      (row, saved) => {
        rows.find((item) => item.id === row.id)!.file = saved;
      },
      progress,
    );
  }
  // Backward compatibility with review records saved before provenance fields existed.
  for (const job of jobs) {
    const previous = (await readReview(job.id))!;
    delete previous.exportFingerprint;
    delete previous.exportArtworkSha256;
    await storeReview(previous);
  }
  const savedJobs = groupCoverJobs(rows);
  assert(
    (await importCoverBatch(batch, savedJobs, progress)).length === 2,
    "Legacy saved ZIP re-import failed",
  );
  for (const job of savedJobs) {
    const review = (await readReview(job.id))!;
    assert(!review.approved && !review.saved, "Re-import did not reset approval/save status");
    assert(
      (await sha256(review.sourceImage)) !==
        (await sha256(await zip.file(`originals/${job.id}.png`)!.async("blob"))),
      "Comparison still uses old artwork instead of current disk cover",
    );
  }
  assert(
    (await importCoverBatch(batch, savedJobs, progress)).length === 2,
    "Repeated pre-save re-import failed",
  );
  rows.forEach((row) => {
    row.librarySourceId = "reopened-fixture";
  });
  const reopened = groupCoverJobs(rows);
  assert(
    (await importCoverBatch(batch, reopened, progress)).length === 2,
    "Reopened source-ID matching failed",
  );
  const changed = {
    ...rows[0],
    file: new File([rows[0].file], rows[0].file.name, {
      lastModified: rows[0].file.lastModified + 99,
    }),
  };
  const good = sources[0].get();
  sources[0].set(changed.file);
  let warnings: string[] = [];
  const partial = await importCoverBatch(
    batch,
    groupCoverJobs([changed, rows[1]]),
    progress,
    (items) => {
      warnings = items;
    },
  );
  assert(
    partial.length === 1 && warnings.length === 1,
    "Unrelated timestamp changes were not blocked safely",
  );
  sources[0].set(good);
  const tampered = await JSZip.loadAsync(await batch.arrayBuffer());
  tampered.file(`originals/${jobs[0].id}.png`, "corrupt original");
  let rejected = false;
  try {
    await importCoverBatch(
      new File([await tampered.generateAsync({ type: "blob" })], "tampered.zip"),
      reopened,
      progress,
    );
  } catch (error) {
    rejected = /Original artwork does not match manifest/.test(String(error));
  }
  assert(rejected, "Tampered original was accepted");
  await importCoverBatch(batch, reopened, progress);
  const largerRows = Array.from({ length: 26 }, (_, index) => {
    const row = rows[index % rows.length],
      album = `Large batch ${index + 1}`;
    return {
      ...row,
      id: album,
      folderName: album,
      folderPath: `Large/${album}`,
      meta: { ...row.meta, path: `Large/${album}/${row.file.name}` },
      tags: { ...row.tags, album },
      original: { ...row.original, album },
    };
  });
  const largerJobs = groupCoverJobs(largerRows);
  const largerZip = await JSZip.loadAsync(
    await (await exportCoverBatch(largerJobs, DEFAULT_WATERMARKS, progress)).arrayBuffer(),
  );
  for (const source of largerJobs) largerZip.file(`edited/${source.id}.png`, edited);
  const largerImported = await importCoverBatch(
    new File([await largerZip.generateAsync({ type: "blob" })], "26-albums.zip"),
    largerJobs,
    progress,
  );
  assert(largerImported.length === 26, "Batches larger than 25 cannot export and import");
  return { rows, batch };
}
function Test() {
  const flushCount = useRef(0);
  const [stability, setStability] = useState(
    "Preview stability test runs when you save the synthetic albums.",
  );
  useEffect(() => {
    let watching = false,
      missing = 0,
      initialFlushes = 0,
      initialTop = 0,
      shifts = 0;
    const check = () => {
      if (!watching) return;
      const dialog = document.querySelector('[role="dialog"]');
      const status = dialog?.querySelector('[role="status"]')?.textContent || "";
      if (
        !dialog?.querySelector('img[alt="Original album artwork"]') ||
        !dialog.querySelector('img[alt="Edited album artwork"]')
      )
        missing++;
      if (
        status.startsWith("Saving") &&
        Math.abs(dialog!.getBoundingClientRect().top - initialTop) > 1
      )
        shifts++;
      if (status.includes("Saved and read-back verified")) {
        watching = false;
        setStability(
          `${missing === 0 && shifts === 0 && flushCount.current - initialFlushes === 1 ? "PASS" : "FAIL"}: ${missing} missing-preview frames, ${shifts} dialog shifts, ${flushCount.current - initialFlushes} library update.`,
        );
      }
    };
    const start = (event: MouseEvent) => {
      const button = (event.target as HTMLElement).closest("button");
      if (button?.textContent?.includes("approved albums") && button.textContent.includes("Save")) {
        watching = true;
        missing = shifts = 0;
        initialFlushes = flushCount.current;
        initialTop = document.querySelector('[role="dialog"]')!.getBoundingClientRect().top;
      }
    };
    const observer = new MutationObserver(check);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
    document.addEventListener("click", start, true);
    return () => {
      observer.disconnect();
      document.removeEventListener("click", start, true);
    };
  }, []);
  const [status, setStatus] = useState("No music files are accessed. All handles are in memory.");
  const [files, setFiles] = useState<Mp3File[]>([]),
    [batch, setBatch] = useState<File>();
  const [open, setOpen] = useState(false);
  return (
    <main className="p-8">
      <h1>Tag Maestro · Re-import regression</h1>
      <p>{stability}</p>
      <p role="status">{status}</p>
      <button
        onClick={() =>
          void runTests(setStatus)
            .then((result) => {
              setFiles(result.rows);
              setBatch(result.batch);
              setOpen(true);
              setStatus(
                "PASS: import/save/re-import, legacy saved records, status reset, repeated import, reopened folder, stale-file/tampered-original refusal and 26-album export/import.",
              );
            })
            .catch((error) => setStatus(`FAIL: ${String(error)}`))
        }
      >
        Run synthetic re-import tests
      </button>
      <button
        disabled={!batch}
        onClick={() =>
          void importCoverBatch(batch!, groupCoverJobs(files), setStatus)
            .then(() => {
              setOpen(true);
              setStatus("Re-import completed — open dialog to review fresh approval state.");
            })
            .catch((error) => setStatus(String(error)))
        }
      >
        Re-import synthetic ZIP again
      </button>
      <CoverCleanupDialog
        open={open}
        onOpenChange={setOpen}
        files={files}
        onTracksSaved={(updates) => {
          flushCount.current++;
          const byId = new Map(updates.map((update) => [update.row.id, update]));
          setFiles((previous) =>
            previous.map((item) => {
              const update = byId.get(item.id);
              return update
                ? {
                    ...item,
                    file: update.file,
                    tags: { ...item.tags, cover: update.cover },
                    original: { ...item.original, cover: update.cover },
                  }
                : item;
            }),
          );
        }}
      />
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Test />);
