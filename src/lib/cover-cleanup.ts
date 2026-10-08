import JSZip from "jszip";
import { readMp3, writeCoverToBlob, type Mp3File, type Mp3Tags } from "./mp3";

export type CoverJob = {
  id: string;
  album: string;
  year: string;
  path: string;
  files: Mp3File[];
  fingerprint: string;
};
export type ReviewSummary = { id: string; fingerprint: string; approved: boolean; saved: boolean };
export type ReviewEdit = ReviewSummary & { image: Blob; sourceImage: Blob };
export const DEFAULT_WATERMARKS = "samperals, samperials, desinapster, desihires.com";
export const MAX_BATCH = 25;

function stableId(value: string) {
  let a = 2166136261,
    b = 5381;
  for (const character of value) {
    a = Math.imul(a ^ character.charCodeAt(0), 16777619);
    b = Math.imul(b, 33) ^ character.charCodeAt(0);
  }
  return `cover-${(a >>> 0).toString(16).padStart(8, "0")}${(b >>> 0).toString(16).padStart(8, "0")}`;
}
export function fileFingerprint(files: Mp3File[]) {
  return JSON.stringify(
    files
      .map((file) => [
        file.libraryRelativePath || file.meta.path || file.file.name,
        file.file.size,
        file.file.lastModified,
      ])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  );
}
/** Folder + album + source, not title alone: duplicate editions never share edits. */
export function groupCoverJobs(files: Mp3File[]): CoverJob[] {
  const groups = new Map<string, Mp3File[]>();
  for (const file of files) {
    const key = JSON.stringify([
      file.librarySourceId || "",
      file.folderPath || file.meta.path.replace(/[/\\][^/\\]+$/, ""),
      file.original.album,
      file.original.year,
    ]);
    groups.set(key, [...(groups.get(key) || []), file]);
  }
  const ids = new Set<string>();
  return [...groups]
    .map(([key, tracks]) => {
      const id = stableId(key);
      if (ids.has(id))
        throw new Error("Album identifier collision; please use a smaller source folder");
      ids.add(id);
      return {
        id,
        album: tracks[0].original.album || tracks[0].folderName || "Untitled album",
        year: tracks[0].original.year,
        path: tracks[0].folderPath,
        files: tracks,
        fingerprint: fileFingerprint(tracks),
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path) || a.album.localeCompare(b.album));
}
export async function sourceCover(job: CoverJob): Promise<NonNullable<Mp3Tags["cover"]>> {
  // Always read the actual source, not an unrelated unsaved editor cover.
  for (const row of job.files) {
    const file = row.sourceHandle ? await row.sourceHandle.getFile() : row.file;
    const read = await readMp3(file, row.meta.path, true, true);
    if (read.tags.cover) return read.tags.cover;
  }
  throw new Error(
    `${job.album}: no embedded cover. Add an original cover in the tag editor first.`,
  );
}
export async function sha256(data: Blob) {
  const digest = await crypto.subtle.digest("SHA-256", await data.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
export function cleanupPrompt(job: CoverJob, watermarks: string) {
  return `Use case: precise-object-edit\nEdit target: originals/${job.id}.png\nAlbum: ${job.album} (${job.year || "year unknown"})\nRemove ONLY clearly identifiable distributor watermarks matching: ${watermarks}. If ambiguous, leave unchanged and flag for review. These words are not permission to remove album titles, publisher/record-label logos or authentic printed credits.\nGently restore faded colours and scan damage. Preserve people's identity, faces, composition, authentic lettering and all logos. Do not invent text or over-sharpen. Restore a square cover without stretching or cutting away artwork; retain content with discreet padding if needed. Do not include a CD jewel-case frame.\nUse Codex's built-in image editor, not LaMa or a paid API. Inspect the edit for changed lettering and faces. Save the selected edited image as edited/${job.id}.png. Never modify songs or source artwork while editing.\n`;
}
export async function exportCoverBatch(
  jobs: CoverJob[],
  watermarks: string,
  progress: (message: string) => void,
) {
  if (!jobs.length || jobs.length > MAX_BATCH)
    throw new Error(`Export between 1 and ${MAX_BATCH} albums at a time`);
  const zip = new JSZip();
  const manifest: {
    id: string;
    album: string;
    year: string;
    path: string;
    fingerprint: string;
    sourceSha256: string;
    original: string;
    edited: string;
  }[] = [];
  for (const [index, job] of jobs.entries()) {
    progress(`Preparing ${index + 1}/${jobs.length}: ${job.album}`);
    const cover = await sourceCover(job);
    const original = `originals/${job.id}.${cover.mime === "image/png" ? "png" : "jpg"}`;
    const blob = new Blob([new Uint8Array(cover.data)], { type: cover.mime });
    zip.file(original, blob);
    zip.file(
      `prompts/${job.id}.txt`,
      cleanupPrompt(job, watermarks).replace(`originals/${job.id}.png`, original),
    );
    manifest.push({
      id: job.id,
      album: job.album,
      year: job.year,
      path: job.path,
      fingerprint: job.fingerprint,
      sourceSha256: await sha256(blob),
      original,
      edited: `edited/${job.id}.png`,
    });
  }
  zip.file(
    "manifest.json",
    JSON.stringify(
      {
        version: 1,
        application: "TagMaestro",
        output: { width: 500, height: 500, format: "image/jpeg" },
        jobs: manifest,
      },
      null,
      2,
    ),
  );
  zip.file(
    "CODEX-PROMPT.md",
    "Please use the imagegen skill and built-in image editor to edit each original using its matching prompts/*.txt. Keep manifest.json and originals unchanged. Put edited images under edited/ with the exact job IDs. Inspect each image, preserve authentic titles/logos/faces, and flag uncertain edits. Return a ZIP containing manifest.json, originals/ and edited/. Do not change audio files. No API calls and no LaMa.\n",
  );
  progress("Creating export ZIP…");
  return zip.generateAsync({ type: "blob", compression: "STORE" });
}
/** Deterministic output normalization only; restoration is done by Codex. */
export async function normalizeCover(blob: Blob): Promise<Blob> {
  if (blob.size > 16 * 1024 * 1024) throw new Error("Cover exceeds the 16 MB image limit");
  const image = await createImageBitmap(blob);
  try {
    if (image.width > 12000 || image.height > 12000)
      throw new Error("Cover dimensions are too large");
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 500;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image canvas unavailable");
    context.fillStyle = "#111111";
    context.fillRect(0, 0, 500, 500);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    const scale = Math.min(500 / image.width, 500 / image.height);
    context.drawImage(
      image,
      (500 - image.width * scale) / 2,
      (500 - image.height * scale) / 2,
      image.width * scale,
      image.height * scale,
    );
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (result) => (result ? resolve(result) : reject(new Error("JPEG conversion failed"))),
        "image/jpeg",
        0.92,
      ),
    );
  } finally {
    image.close();
  }
}
export async function blobCover(blob: Blob): Promise<NonNullable<Mp3Tags["cover"]>> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
  return { data: new Uint8Array(await blob.arrayBuffer()), mime: blob.type, dataUrl };
}

let database: Promise<IDBDatabase> | undefined;
function db() {
  return (database ||= new Promise((resolve, reject) => {
    const request = indexedDB.open("tagmaestro-cover-review", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("edits", { keyPath: "id" });
      request.result.createObjectStore("summaries", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
}
export async function storeReview(edit: ReviewEdit) {
  const database = await db();
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(["edits", "summaries"], "readwrite");
    transaction.objectStore("edits").put(edit);
    const { image: _image, sourceImage: _sourceImage, ...summary } = edit;
    transaction.objectStore("summaries").put(summary);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
export async function readReview(id: string): Promise<ReviewEdit | undefined> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const request = database.transaction("edits").objectStore("edits").get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function reviewSummaries(): Promise<ReviewSummary[]> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const request = database.transaction("summaries").objectStore("summaries").getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function checkZipEntry(entry: JSZip.JSZipObject, maximum: number) {
  // JSZip's central-directory size is available before inflation. This avoids
  // allocating an enormous image/manifest from a very small compressed ZIP.
  const size = (entry as unknown as { _data?: { uncompressedSize?: number } })._data
    ?.uncompressedSize;
  if (typeof size === "number" && size > maximum)
    throw new Error(`ZIP entry too large: ${entry.name}`);
}

export async function importCoverBatch(
  file: File,
  jobs: CoverJob[],
  progress: (message: string) => void,
  reportWarnings: (warnings: string[]) => void = () => undefined,
): Promise<ReviewSummary[]> {
  if (file.size > 100 * 1024 * 1024) throw new Error("ZIP exceeds 100 MB. Please split the batch.");
  const zip = await JSZip.loadAsync(file);
  const manifestFile = zip.file("manifest.json");
  if (!manifestFile)
    throw new Error(
      "Missing manifest.json. Use an exported Codex batch or assign a single image explicitly.",
    );
  checkZipEntry(manifestFile, 2 * 1024 * 1024);
  const manifest = JSON.parse(await manifestFile.async("string"));
  if (
    manifest.version !== 1 ||
    manifest.application !== "TagMaestro" ||
    !Array.isArray(manifest.jobs) ||
    manifest.jobs.length > MAX_BATCH
  )
    throw new Error("Invalid cover manifest");
  const byId = new Map(jobs.map((job) => [job.id, job]));
  const ids = new Set<string>();
  const prepared: ReviewEdit[] = [];
  const warnings: string[] = [];
  for (const entry of manifest.jobs) {
    if (ids.has(entry.id)) throw new Error("Duplicate job in manifest");
    ids.add(entry.id);
    // Partial exports intentionally omit edits for skipped/rejected albums.
    const edited =
      zip.file(`edited/${entry.id}.png`) ||
      zip.file(`edited/${entry.id}.jpg`) ||
      zip.file(`edited/${entry.id}.jpeg`);
    if (!edited) continue;
    // Re-adding a source folder can create a new browser source ID. Match only
    // a unique, identical folder and full track fingerprint, never title alone.
    const direct = byId.get(entry.id);
    const matches = jobs.filter(
      (job) => job.path === entry.path && job.fingerprint === entry.fingerprint,
    );
    const job =
      direct?.fingerprint === entry.fingerprint
        ? direct
        : matches.length === 1
          ? matches[0]
          : undefined;
    if (!job) {
      warnings.push(
        `${entry.album}: source files changed, missing or ambiguous. Export a fresh batch for this album.`,
      );
      continue;
    }
    if (!/^originals\/cover-[a-f0-9]{16}\.(png|jpg)$/.test(entry.original))
      throw new Error("Invalid original artwork path");
    const original = zip.file(entry.original);
    if (!original) throw new Error(`Missing original artwork for ${job.album}`);
    checkZipEntry(original, 16 * 1024 * 1024);
    const sourceImage = await original.async("blob");
    if (sourceImage.size > 16 * 1024 * 1024 || (await sha256(sourceImage)) !== entry.sourceSha256)
      throw new Error("Original artwork does not match manifest");
    checkZipEntry(edited, 16 * 1024 * 1024);
    progress(`Importing: ${job.album}`);
    const actual = await sourceCover(job);
    if ((await sha256(new Blob([new Uint8Array(actual.data)]))) !== entry.sourceSha256) {
      warnings.push(
        `${job.album}: source artwork changed since export. Export a fresh batch for this album.`,
      );
      continue;
    }
    prepared.push({
      id: job.id,
      fingerprint: job.fingerprint,
      approved: false,
      saved: false,
      image: await normalizeCover(await edited.async("blob")),
      sourceImage,
    });
  }
  if (!prepared.length)
    throw new Error(
      warnings.length
        ? `No covers imported. ${warnings.join("\n")}`
        : "No matching edited images under edited/. Keep the exported job IDs as filenames.",
    );
  for (const edit of prepared) await storeReview(edit);
  reportWarnings(warnings);
  return prepared.map(({ image: _image, sourceImage: _sourceImage, ...summary }) => summary);
}

type WritableHandle = FileSystemFileHandle & {
  queryPermission?: (options: { mode: "readwrite" }) => Promise<PermissionState>;
  requestPermission?: (options: { mode: "readwrite" }) => Promise<PermissionState>;
};
export async function saveReviewedAlbum(
  job: CoverJob,
  edit: ReviewEdit,
  onTrackSaved: (row: Mp3File, file: File, cover: NonNullable<Mp3Tags["cover"]>) => void,
  progress: (message: string) => void,
) {
  if (!edit.approved || edit.saved || edit.fingerprint !== job.fingerprint)
    throw new Error("Album must be reviewed and approved for the current source files");
  if (!job.files.every((row) => row.sourceHandle))
    throw new Error(
      "Direct saving needs Chrome/Edge and Add Folder (read/write access). Reopen the source folder with Add Folder.",
    );
  // Obtain permissions BEFORE generating files; never prompt half way through a song.
  for (const row of job.files) {
    const handle = row.sourceHandle as WritableHandle;
    let permission = await handle.queryPermission?.({ mode: "readwrite" });
    if (permission !== "granted")
      permission = await handle.requestPermission?.({ mode: "readwrite" });
    if (permission !== "granted")
      throw new Error("Write permission was not granted; original files unchanged");
    const live = await handle.getFile();
    if (live.size !== row.file.size || live.lastModified !== row.file.lastModified)
      throw new Error(`${row.file.name} changed since scanning. Reload before saving.`);
  }
  const cover = await blobCover(edit.image);
  const updated: Mp3File[] = [];
  for (const [index, row] of job.files.entries()) {
    progress(`Saving ${job.album}: ${index + 1}/${job.files.length} (${row.file.name})`);
    const handle = row.sourceHandle as WritableHandle;
    const live = await handle.getFile();
    if (live.size !== row.file.size || live.lastModified !== row.file.lastModified)
      throw new Error(
        `${row.file.name} changed during saving. Previously completed songs stay saved.`,
      );
    const blob = await writeCoverToBlob(live, cover);
    const expected = await sha256(blob);
    const writable = await handle.createWritable();
    try {
      await writable.write(blob);
      await writable.close();
    } catch (error) {
      await writable.abort().catch(() => {});
      throw error;
    }
    const saved = await handle.getFile();
    if ((await sha256(saved)) !== expected)
      throw new Error(
        `Read-back verification failed: ${row.file.name}. Check the disk before continuing.`,
      );
    onTrackSaved(row, saved, cover);
    updated.push({ ...row, file: saved });
  }
  await storeReview({
    ...edit,
    fingerprint: fileFingerprint(updated),
    saved: true,
    approved: false,
  });
}
