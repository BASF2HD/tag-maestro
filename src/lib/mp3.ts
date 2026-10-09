// Client-only audio tag utilities.
// Reads tags with jsmediatags and writes format-native tags with TagLib-Wasm.
import jsmediatags from "jsmediatags/dist/jsmediatags.min.js";
import type { AudioFile, PropertyMap, TagLib } from "taglib-wasm";
import { replaceWavArtwork, wavPreservedBytes } from "./wav-artwork";

export type AudioFormat = "mp3" | "m4a" | "flac" | "wav" | "other";

export function detectFormat(file: File): AudioFormat {
  const n = file.name.toLowerCase();
  if (n.endsWith(".mp3") || file.type === "audio/mpeg") return "mp3";
  if (
    n.endsWith(".m4a") ||
    n.endsWith(".mp4") ||
    file.type === "audio/mp4" ||
    file.type === "audio/x-m4a"
  )
    return "m4a";
  if (n.endsWith(".flac") || file.type === "audio/flac" || file.type === "audio/x-flac")
    return "flac";
  if (
    n.endsWith(".wav") ||
    file.type === "audio/wav" ||
    file.type === "audio/wave" ||
    file.type === "audio/x-wav"
  )
    return "wav";
  return "other";
}

export const SUPPORTED_EXTS = [".mp3", ".m4a", ".flac", ".wav"] as const;
export const IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif"] as const;
export const SUPPORTED_ACCEPT =
  "audio/mpeg,audio/mp4,audio/x-m4a,audio/flac,audio/x-flac,audio/wav,audio/x-wav,.mp3,.m4a,.flac,.wav";

export interface Mp3Tags {
  title: string;
  artist: string;
  album: string;
  albumArtist: string;
  composer: string;
  year: string;
  tag: string;
  genre: string;
  discnumber: string;
  track: string;
  comment: string;
  bpm: string;
  cover?: { data: Uint8Array; mime: string; dataUrl: string };
}

export interface FileMeta {
  path: string;
  codec: string;
  bitrate: string;
  frequency: string;
  length: string;
  vbr: string;
  mode: string;
  size: string;
  modified: string;
}

export interface Mp3File {
  id: string;
  file: File;
  sourceHandle?: FileSystemFileHandle;
  sourceDirectoryHandle?: FileSystemDirectoryHandle;
  /** Persisted root-folder source used to restore this row after a refresh. */
  librarySourceId?: string;
  libraryRelativePath?: string;
  format: AudioFormat;
  tags: Mp3Tags;
  meta: FileMeta;
  original: Mp3Tags;
  dirty: boolean;
  /** Explicit artwork edits, including deletion, must not be undone by lazy loading. */
  coverEdited?: boolean;
  folderName: string;
  folderPath: string;
  editedFolderName: string;
  /** If set, overrides the pattern-based rename with this exact base name (no extension). */
  renamedBase?: string;
}

let tagLibPromise: Promise<TagLib> | null = null;
let tagReadQueue: Promise<void> = Promise.resolve();

function getTagLib(): Promise<TagLib> {
  if (!tagLibPromise) {
    tagLibPromise = import("taglib-wasm").then(({ TagLib }) => TagLib.initialize());
  }
  return tagLibPromise;
}

function queueTagLibRead<T>(read: () => Promise<T>): Promise<T> {
  const next = tagReadQueue.then(read, read);
  tagReadQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

export const emptyTags = (): Mp3Tags => ({
  title: "",
  artist: "",
  album: "",
  albumArtist: "",
  composer: "",
  year: "",
  tag: "",
  genre: "",
  discnumber: "",
  track: "",
  comment: "",
  bpm: "",
});

export const emptyMeta = (): FileMeta => ({
  path: "",
  codec: "",
  bitrate: "",
  frequency: "",
  length: "",
  vbr: "",
  mode: "",
  size: "",
  modified: "",
});

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

async function readAudioMeta(
  file: File,
  format: AudioFormat,
  arrayBuffer: ArrayBuffer | null,
  skipAudioDecode?: boolean,
): Promise<FileMeta> {
  const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
  const meta: FileMeta = {
    path,
    codec: format === "other" ? "Unknown" : format.toUpperCase(),
    bitrate: "",
    frequency: "",
    length: "",
    vbr: "",
    mode: "",
    size: formatBytes(file.size),
    modified: new Date(file.lastModified).toLocaleString(),
  };

  if (skipAudioDecode || !arrayBuffer) {
    return meta;
  }

  try {
    const ctx = new AudioContext();
    const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
    meta.length = formatDuration(decoded.duration);
    meta.frequency = `${decoded.sampleRate} Hz`;
    meta.mode =
      decoded.numberOfChannels === 1
        ? "Mono"
        : decoded.numberOfChannels === 2
          ? "Stereo"
          : `${decoded.numberOfChannels}ch`;
    if (decoded.duration > 0) {
      meta.bitrate = `${Math.round((file.size * 8) / decoded.duration / 1000)} kbps`;
    }
    await ctx.close();
  } catch {
    // Some formats may fail to decode in the browser; leave technical fields empty.
  }

  return meta;
}

function u8ToDataUrl(u8: Uint8Array, mime: string): string {
  let bin = "";
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
  return `data:${mime};base64,${btoa(bin)}`;
}

/**
 * Extract the immediate parent folder name from a relative path.
 * e.g. "Music/Albums/My Album/song.mp3" → "My Album"
 * If there is no folder part, returns "".
 */
export function extractFolderName(relativePath: string): string {
  // Normalise separators
  const parts = relativePath.replace(/\\/g, "/").split("/").filter(Boolean);
  // parts: ["Music", "Albums", "My Album", "song.mp3"]
  // The folder containing the file is the second-to-last part
  if (parts.length < 2) return "";
  return parts[parts.length - 2];
}

/**
 * Extract the folder path (everything except the filename) from a relative path.
 * e.g. "Music/Albums/My Album/song.mp3" → "Music/Albums/My Album"
 */
export function extractFolderPath(relativePath: string): string {
  const parts = relativePath.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length < 2) return "";
  return parts.slice(0, -1).join("/");
}

export async function readMp3(
  file: File,
  relativePath?: string,
  skipAudioDecode?: boolean,
  readEmbeddedCover = true,
  sourceHandle?: FileSystemFileHandle,
  sourceDirectoryHandle?: FileSystemDirectoryHandle,
): Promise<Mp3File> {
  const format = detectFormat(file);
  const tags =
    format === "wav"
      ? await readWavTags(file, readEmbeddedCover)
      : await readTagsWithJsMedia(file, readEmbeddedCover);
  const rp =
    relativePath || (file as File & { webkitRelativePath?: string }).webkitRelativePath || "";
  const folderName = extractFolderName(rp || file.name);
  const folderPath = extractFolderPath(rp || file.name);

  let arrayBuffer: ArrayBuffer | null = null;
  if (!skipAudioDecode) {
    try {
      arrayBuffer = await file.arrayBuffer();
    } catch {
      // ignore
    }
  }

  const meta = await readAudioMeta(file, format, arrayBuffer, skipAudioDecode);
  return {
    id: crypto.randomUUID(),
    file,
    sourceHandle,
    sourceDirectoryHandle,
    format,
    tags,
    meta,
    original: structuredClone({ ...tags, cover: tags.cover ? { ...tags.cover } : undefined }),
    dirty: false,
    folderName,
    folderPath,
    editedFolderName: folderName,
  };
}

export async function writeTagsToBlob(m: Mp3File): Promise<Blob> {
  const arrayBuffer = await m.file.arrayBuffer();
  if (m.format === "other") {
    throw new Error(`Unsupported audio format: ${m.file.name}`);
  }

  const taglib = await getTagLib();
  const output = await taglib.edit(
    { name: m.file.name, data: new Uint8Array(arrayBuffer) },
    (audioFile) => applyTagChanges(audioFile, m),
  );
  const tagged =
    m.format === "wav" && (m.coverEdited || !coversEqual(m.tags.cover, m.original.cover))
      ? updateWavCover(output, m.tags.cover)
      : output;
  const blob = new Blob([new Uint8Array(tagged)], { type: m.file.type || mimeForFormat(m.format) });
  if (m.coverEdited || !coversEqual(m.tags.cover, m.original.cover)) {
    await verifyWrittenArtwork(new File([blob], m.file.name), m.tags.cover);
  }
  return blob;
}

/** Cover cleanup never applies pending text edits, renames or audio encoding. */
export async function writeCoverToBlob(
  file: File,
  cover: NonNullable<Mp3Tags["cover"]>,
): Promise<Blob> {
  const input = new Uint8Array(await file.arrayBuffer());
  const format = detectFormat(file);
  let output: Uint8Array;
  if (format === "wav") {
    output = replaceWavArtwork(input, cover.data, cover.mime);
    const before = wavPreservedBytes(input);
    const after = wavPreservedBytes(output);
    if (before.length !== after.length || before.some((byte, index) => byte !== after[index]))
      throw new Error("Audio/metadata preservation check failed; original was not changed");
  } else {
    if (format === "other") throw new Error("Unsupported audio format");
    const taglib = await getTagLib();
    output = await taglib.edit({ name: file.name, data: input }, (audio) => {
      const other = audio.getPictures().filter((picture) => picture.type !== "FrontCover");
      audio.setPictures([
        { type: "FrontCover", mimeType: cover.mime, data: cover.data, description: "Cover" },
        ...other,
      ]);
    });
  }
  const blob = new Blob([new Uint8Array(output)], { type: file.type || mimeForFormat(format) });
  await verifyWrittenArtwork(new File([blob], file.name), cover);
  return blob;
}

/** Verify the embedded picture itself, not an editor thumbnail or folder JPEG. */
export async function verifyWrittenArtwork(file: File, expected: Mp3Tags["cover"]) {
  const actual =
    detectFormat(file) === "wav"
      ? readWavCover(new Uint8Array(await file.arrayBuffer()))
      : (await readTextTagsWithTagLib(file, true)).cover;
  if (!coversEqual(actual, expected)) {
    throw new Error(
      `Artwork verification failed for ${file.name}. Original file was not marked saved.`,
    );
  }
}

async function readTagsWithJsMedia(file: File, readEmbeddedCover: boolean): Promise<Mp3Tags> {
  const primary = await new Promise<Mp3Tags>((resolve) => {
    const t = emptyTags();
    jsmediatags.read(file, {
      onSuccess: (result: any) => {
        const g = result.tags || {};
        t.title = g.title || "";
        t.artist = g.artist || "";
        t.album = g.album || "";
        t.albumArtist = g.band || g["TPE2"]?.data || "";
        t.composer = g.composer || "";
        t.year = String(g.year || "");
        t.tag = g.grouping || g.contentGroupDescription || "";
        t.genre = g.genre || "";
        t.discnumber = String(g.disc || g.partOfSet || "");
        t.track = String(g.track || "");
        t.comment = typeof g.comment === "object" ? g.comment?.text || "" : g.comment || "";
        t.bpm = String(g.bpm || g.beatsPerMinute || "");
        if (readEmbeddedCover && g.picture) {
          const data = new Uint8Array(g.picture.data);
          const mime = g.picture.format || "image/jpeg";
          t.cover = { data, mime, dataUrl: u8ToDataUrl(data, mime) };
        }
        resolve(t);
      },
      onError: () => resolve(t),
    });
  });

  if (primary.title.trim()) return primary;

  try {
    const fallback = await queueTagLibRead(() =>
      readTextTagsWithTagLib(file, readEmbeddedCover && !primary.cover),
    );
    return mergeMissingTags(primary, fallback);
  } catch {
    return primary;
  }
}

async function readTextTagsWithTagLib(file: File, readEmbeddedCover: boolean): Promise<Mp3Tags> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const taglib = await getTagLib();
  const audioFile = await taglib.open({ name: file.name, data: bytes });
  try {
    const properties = audioFile.properties();
    const tags: Mp3Tags = {
      title: firstValue(properties.title),
      artist: firstValue(properties.artist),
      album: firstValue(properties.album),
      albumArtist: firstValue(properties.albumArtist),
      composer: firstValue(properties.composer),
      year: firstValue(properties.date),
      tag: firstValue(properties.grouping),
      genre: firstValue(properties.genre),
      discnumber: joinNumberPair(
        firstValue(properties.discNumber),
        firstValue(properties.totalDiscs),
      ),
      track: joinNumberPair(firstValue(properties.trackNumber), firstValue(properties.totalTracks)),
      comment: firstValue(properties.comment),
      bpm: firstValue(properties.bpm),
    };
    if (readEmbeddedCover) {
      const pictures = audioFile.getPictures();
      const picture = pictures.find((candidate) => candidate.type === "FrontCover") || pictures[0];
      if (picture) {
        const data = new Uint8Array(picture.data);
        const mime = picture.mimeType || "image/jpeg";
        tags.cover = { data, mime, dataUrl: u8ToDataUrl(data, mime) };
      }
    }
    return tags;
  } finally {
    audioFile.dispose();
  }
}

function mergeMissingTags(primary: Mp3Tags, fallback: Mp3Tags): Mp3Tags {
  return {
    title: primary.title || fallback.title,
    artist: primary.artist || fallback.artist,
    album: primary.album || fallback.album,
    albumArtist: primary.albumArtist || fallback.albumArtist,
    composer: primary.composer || fallback.composer,
    year: primary.year || fallback.year,
    tag: primary.tag || fallback.tag,
    genre: primary.genre || fallback.genre,
    discnumber: primary.discnumber || fallback.discnumber,
    track: primary.track || fallback.track,
    comment: primary.comment || fallback.comment,
    bpm: primary.bpm || fallback.bpm,
    cover: primary.cover || fallback.cover,
  };
}

async function readWavTags(file: File, readEmbeddedCover: boolean): Promise<Mp3Tags> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const taglib = await getTagLib();
  const audioFile = await taglib.open({ name: file.name, data: bytes });
  try {
    const properties = audioFile.properties();
    const track = joinNumberPair(
      firstValue(properties.trackNumber),
      firstValue(properties.totalTracks),
    );
    const disc = joinNumberPair(
      firstValue(properties.discNumber),
      firstValue(properties.totalDiscs),
    );
    const tags: Mp3Tags = {
      title: firstValue(properties.title),
      artist: firstValue(properties.artist),
      album: firstValue(properties.album),
      albumArtist: firstValue(properties.albumArtist),
      composer: firstValue(properties.composer),
      year: firstValue(properties.date),
      tag: firstValue(properties.grouping),
      genre: firstValue(properties.genre),
      discnumber: disc,
      track,
      comment: firstValue(properties.comment),
      bpm: firstValue(properties.bpm),
    };
    if (readEmbeddedCover) tags.cover = readWavCover(bytes);
    return tags;
  } finally {
    audioFile.dispose();
  }
}

function firstValue(values: string[] | undefined): string {
  return values?.[0] || "";
}

function joinNumberPair(number: string, total: string): string {
  return total ? `${number}/${total}` : number;
}

function applyTagChanges(audioFile: AudioFile, m: Mp3File): void {
  const t = m.tags;
  const [trackNumber, totalTracks] = splitNumberPair(t.track);
  const [discNumber, totalDiscs] = splitNumberPair(t.discnumber);
  const managed: PropertyMap = {
    title: stringValues(t.title),
    artist: stringValues(t.artist),
    album: stringValues(t.album),
    albumArtist: stringValues(t.albumArtist),
    composer: stringValues(t.composer),
    date: stringValues(t.year),
    grouping: stringValues(t.tag),
    genre: stringValues(t.genre),
    discNumber: stringValues(discNumber),
    totalDiscs: stringValues(totalDiscs),
    trackNumber: stringValues(trackNumber),
    totalTracks: stringValues(totalTracks),
    comment: stringValues(t.comment),
    bpm: stringValues(t.bpm),
  };

  audioFile.setProperties({ ...audioFile.properties(), ...managed });

  if (!m.coverEdited && coversEqual(t.cover, m.original.cover)) return;
  // TagLib's WAV backend writes text fields but not embedded pictures.
  // WAV artwork is handled as a standard RIFF ID3 chunk after TagLib saves.
  if (m.format === "wav") return;
  if (!t.cover) {
    audioFile.removePictures();
    return;
  }

  const otherPictures = audioFile.getPictures().filter((picture) => picture.type !== "FrontCover");
  audioFile.setPictures([
    {
      type: "FrontCover",
      mimeType: t.cover.mime,
      data: t.cover.data,
      description: "Cover",
    },
    ...otherPictures,
  ]);
}

function stringValues(value: string): string[] {
  return value.trim() ? [value] : [];
}

function splitNumberPair(value: string): [string, string] {
  const [number = "", total = ""] = value.split("/", 2);
  return [number.trim(), total.trim()];
}

function coversEqual(a: Mp3Tags["cover"], b: Mp3Tags["cover"]): boolean {
  if (!a || !b) return a === b;
  if (a.mime !== b.mime || a.data.byteLength !== b.data.byteLength) return false;
  for (let i = 0; i < a.data.byteLength; i++) {
    if (a.data[i] !== b.data[i]) return false;
  }
  return true;
}

function mimeForFormat(format: AudioFormat): string {
  if (format === "mp3") return "audio/mpeg";
  if (format === "m4a") return "audio/mp4";
  if (format === "flac") return "audio/flac";
  if (format === "wav") return "audio/wav";
  return "application/octet-stream";
}

function updateWavCover(wav: Uint8Array, cover: Mp3Tags["cover"]): Uint8Array {
  if (ascii(wav, 0, 4) !== "RIFF" || ascii(wav, 8, 12) !== "WAVE") {
    throw new Error("Invalid WAV container");
  }

  const parts: Uint8Array[] = [wav.slice(0, 12)];
  let offset = 12;
  let replacedId3 = false;

  while (offset + 8 <= wav.byteLength) {
    const chunkId = ascii(wav, offset, offset + 4);
    const chunkSize = readUint32LE(wav, offset + 4);
    const dataStart = offset + 8;
    const chunkEnd = dataStart + chunkSize;
    const paddedEnd = chunkEnd + (chunkSize & 1);
    if (chunkEnd > wav.byteLength) break;

    if (chunkId.toLowerCase() === "id3 ") {
      if (!replacedId3) {
        const id3 = replaceId3Cover(wav.slice(dataStart, chunkEnd), cover);
        if (id3.byteLength) parts.push(makeRiffChunk("id3 ", id3));
        replacedId3 = true;
      }
    } else {
      parts.push(wav.slice(offset, Math.min(paddedEnd, wav.byteLength)));
    }
    offset = paddedEnd;
  }

  if (offset < wav.byteLength) parts.push(wav.slice(offset));
  if (!replacedId3 && cover) parts.push(makeRiffChunk("id3 ", makeId3Tag([], cover, 3)));

  const output = concatBytes(parts);
  writeUint32LE(output, 4, output.byteLength - 8);
  return output;
}

function readWavCover(wav: Uint8Array): Mp3Tags["cover"] {
  if (ascii(wav, 0, 4) !== "RIFF" || ascii(wav, 8, 12) !== "WAVE") return undefined;

  let offset = 12;
  while (offset + 8 <= wav.byteLength) {
    const chunkId = ascii(wav, offset, offset + 4);
    const chunkSize = readUint32LE(wav, offset + 4);
    const dataStart = offset + 8;
    const chunkEnd = dataStart + chunkSize;
    if (chunkEnd > wav.byteLength) return undefined;
    if (chunkId.toLowerCase() === "id3 ") {
      return readId3Cover(wav.subarray(dataStart, chunkEnd));
    }
    offset = chunkEnd + (chunkSize & 1);
  }
  return undefined;
}

function readId3Cover(tag: Uint8Array): Mp3Tags["cover"] {
  if (tag.byteLength < 10 || ascii(tag, 0, 3) !== "ID3") return undefined;
  const version = tag[3] === 4 ? 4 : 3;
  const tagEnd = Math.min(tag.byteLength, 10 + readSyncSafe(tag, 6));
  let offset = id3FrameStart(tag, tagEnd, version);
  let fallback: Mp3Tags["cover"];

  while (offset + 10 <= tagEnd) {
    const id = ascii(tag, offset, offset + 4);
    if (!/^[A-Z0-9]{4}$/.test(id)) break;
    const size = version === 4 ? readSyncSafe(tag, offset + 4) : readUint32BE(tag, offset + 4);
    const bodyStart = offset + 10;
    const bodyEnd = bodyStart + size;
    if (bodyEnd > tagEnd) break;
    if (id === "APIC") {
      const body = tag.subarray(bodyStart, bodyEnd);
      const parsed = parseApicBody(body);
      fallback ||= parsed;
      const mimeEnd = body.indexOf(0, 1);
      if (mimeEnd >= 0 && body[mimeEnd + 1] === 3 && parsed) return parsed;
    }
    offset = bodyEnd;
  }
  return fallback;
}

function parseApicBody(body: Uint8Array): Mp3Tags["cover"] {
  if (body.byteLength < 5) return undefined;
  const encoding = body[0];
  const mimeEnd = body.indexOf(0, 1);
  if (mimeEnd < 0 || mimeEnd + 2 >= body.byteLength) return undefined;
  const mime = ascii(body, 1, mimeEnd) || "image/jpeg";
  const descriptionStart = mimeEnd + 2;
  let dataStart = descriptionStart;

  if (encoding === 1 || encoding === 2) {
    while (dataStart + 1 < body.byteLength) {
      if (body[dataStart] === 0 && body[dataStart + 1] === 0) {
        dataStart += 2;
        break;
      }
      dataStart += 2;
    }
  } else {
    const descriptionEnd = body.indexOf(0, descriptionStart);
    dataStart = descriptionEnd < 0 ? body.byteLength : descriptionEnd + 1;
  }

  if (dataStart >= body.byteLength) return undefined;
  const data = body.slice(dataStart);
  return { data, mime, dataUrl: u8ToDataUrl(data, mime) };
}

function replaceId3Cover(existing: Uint8Array, cover: Mp3Tags["cover"]): Uint8Array {
  if (existing.byteLength < 10 || ascii(existing, 0, 3) !== "ID3") {
    return cover ? makeId3Tag([], cover, 3) : new Uint8Array();
  }

  const version = existing[3] === 4 ? 4 : 3;
  const tagEnd = Math.min(existing.byteLength, 10 + readSyncSafe(existing, 6));
  const frames: Uint8Array[] = [];
  let offset = id3FrameStart(existing, tagEnd, version);

  while (offset + 10 <= tagEnd) {
    const id = ascii(existing, offset, offset + 4);
    if (!/^[A-Z0-9]{4}$/.test(id)) break;
    const size =
      version === 4 ? readSyncSafe(existing, offset + 4) : readUint32BE(existing, offset + 4);
    const end = offset + 10 + size;
    if (size < 0 || end > tagEnd) break;
    if (id !== "APIC") frames.push(existing.slice(offset, end));
    offset = end;
  }

  if (!cover && !frames.length) return new Uint8Array();
  return makeId3Tag(frames, cover, version);
}

function id3FrameStart(tag: Uint8Array, tagEnd: number, version: number): number {
  if (!(tag[5] & 0x40) || tagEnd < 14) return 10;
  const size = version === 4 ? readSyncSafe(tag, 10) : readUint32BE(tag, 10) + 4;
  return Math.min(tagEnd, 10 + size);
}

function makeId3Tag(
  retainedFrames: Uint8Array[],
  cover: Mp3Tags["cover"],
  version: 3 | 4,
): Uint8Array {
  const frames = cover ? [...retainedFrames, makeApicFrame(cover, version)] : retainedFrames;
  const body = concatBytes(frames);
  const header = new Uint8Array(10);
  header.set([0x49, 0x44, 0x33, version, 0, 0], 0);
  writeSyncSafe(header, 6, body.byteLength);
  return concatBytes([header, body]);
}

function makeApicFrame(cover: NonNullable<Mp3Tags["cover"]>, version: 3 | 4): Uint8Array {
  const mime = new TextEncoder().encode(cover.mime || "image/jpeg");
  const body = concatBytes([new Uint8Array([0]), mime, new Uint8Array([0, 3, 0]), cover.data]);
  const frame = new Uint8Array(10 + body.byteLength);
  frame.set([0x41, 0x50, 0x49, 0x43], 0);
  if (version === 4) writeSyncSafe(frame, 4, body.byteLength);
  else writeUint32BE(frame, 4, body.byteLength);
  frame.set(body, 10);
  return frame;
}

function makeRiffChunk(id: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(8 + data.byteLength + (data.byteLength & 1));
  chunk.set(new TextEncoder().encode(id), 0);
  writeUint32LE(chunk, 4, data.byteLength);
  chunk.set(data, 8);
  return chunk;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, false);
}

function writeUint32LE(bytes: Uint8Array, offset: number, value: number): void {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(offset, value, true);
}

function writeUint32BE(bytes: Uint8Array, offset: number, value: number): void {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(offset, value, false);
}

function readSyncSafe(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] & 0x7f) << 21) |
    ((bytes[offset + 1] & 0x7f) << 14) |
    ((bytes[offset + 2] & 0x7f) << 7) |
    (bytes[offset + 3] & 0x7f)
  );
}

function writeSyncSafe(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >> 21) & 0x7f;
  bytes[offset + 1] = (value >> 14) & 0x7f;
  bytes[offset + 2] = (value >> 7) & 0x7f;
  bytes[offset + 3] = value & 0x7f;
}

export function dataUrlToCover(dataUrl: string): Mp3Tags["cover"] {
  const m = /^data:(.+?);base64,(.*)$/.exec(dataUrl);
  if (!m) return undefined;
  const mime = m[1];
  const bin = atob(m[2]);
  const data = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
  return { data, mime, dataUrl };
}

export function renameByPattern(pattern: string, t: Mp3Tags, fallback: string): string {
  const safe = (s: string) => s.replace(/[\\/:*?"<>|]/g, "_").trim();
  const out = pattern
    .replace(/%artist%/gi, safe(t.artist) || "Unknown Artist")
    .replace(/%title%/gi, safe(t.title) || fallback)
    .replace(/%album%/gi, safe(t.album) || "Unknown Album")
    .replace(/%track%/gi, safe(t.track).padStart(2, "0") || "00")
    .replace(/%year%/gi, safe(t.year) || "")
    .replace(/%genre%/gi, safe(t.genre) || "");
  return (out || fallback).replace(/\s+/g, " ").trim();
}
