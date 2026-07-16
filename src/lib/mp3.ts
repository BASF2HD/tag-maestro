// Client-only audio tag utilities.
// Reads tags with jsmediatags (MP3, M4A, FLAC; best-effort WAV).
// Writes ID3 tags for MP3 with browser-id3-writer. Other formats are
// currently exported with the original bytes (rename + AI edits still work in-app;
// tag-write for M4A/FLAC/WAV is not yet supported by browser libs).
import jsmediatags from "jsmediatags/dist/jsmediatags.min.js";
import { ID3Writer } from "browser-id3-writer";

export type AudioFormat = "mp3" | "m4a" | "flac" | "wav" | "other";

export function detectFormat(file: File): AudioFormat {
  const n = file.name.toLowerCase();
  if (n.endsWith(".mp3") || file.type === "audio/mpeg") return "mp3";
  if (n.endsWith(".m4a") || n.endsWith(".mp4") || file.type === "audio/mp4" || file.type === "audio/x-m4a") return "m4a";
  if (n.endsWith(".flac") || file.type === "audio/flac" || file.type === "audio/x-flac") return "flac";
  if (n.endsWith(".wav") || file.type === "audio/wav" || file.type === "audio/wave" || file.type === "audio/x-wav") return "wav";
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
  format: AudioFormat;
  tags: Mp3Tags;
  meta: FileMeta;
  original: Mp3Tags;
  dirty: boolean;
  folderName: string;
  folderPath: string;
  editedFolderName: string;
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
  const path =
    (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
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
): Promise<Mp3File> {
  const format = detectFormat(file);
  const tags = await new Promise<Mp3Tags>((resolve) => {
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
        if (g.picture) {
          const data = new Uint8Array(g.picture.data);
          const mime = g.picture.format || "image/jpeg";
          t.cover = { data, mime, dataUrl: u8ToDataUrl(data, mime) };
        }
        resolve(t);
      },
      onError: () => resolve(t),
    });
  });
  const rp = relativePath || (file as File & { webkitRelativePath?: string }).webkitRelativePath || "";
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
  // Only MP3 gets ID3 tags written. Other formats are returned as-is so the
  // user still gets renamed files and can apply edits in-app.
  if (m.format !== "mp3") {
    return new Blob([arrayBuffer], { type: m.file.type || "application/octet-stream" });
  }
  const writer = new ID3Writer(arrayBuffer);
  const t = m.tags;
  if (t.title) writer.setFrame("TIT2", t.title);
  if (t.artist) writer.setFrame("TPE1", [t.artist]);
  if (t.album) writer.setFrame("TALB", t.album);
  if (t.albumArtist) writer.setFrame("TPE2", t.albumArtist);
  if (t.composer) writer.setFrame("TCOM", [t.composer]);
  if (t.year) writer.setFrame("TYER", parseInt(t.year, 10) || 0);
  if (t.tag) writer.setFrame("TIT1", t.tag);
  if (t.genre) writer.setFrame("TCON", [t.genre]);
  if (t.discnumber) writer.setFrame("TPOS", t.discnumber);
  if (t.track) writer.setFrame("TRCK", t.track);
  if (t.bpm) writer.setFrame("TBPM", parseInt(t.bpm, 10) || 0);
  if (t.comment) writer.setFrame("COMM", { description: "", text: t.comment, language: "eng" });
  if (t.cover) {
    writer.setFrame("APIC", {
      type: 3,
      data: t.cover.data.buffer.slice(t.cover.data.byteOffset, t.cover.data.byteOffset + t.cover.data.byteLength),
      description: "Cover",
    });
  }
  writer.addTag();
  return writer.getBlob();
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