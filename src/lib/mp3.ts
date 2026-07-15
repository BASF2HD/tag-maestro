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
export const SUPPORTED_ACCEPT =
  "audio/mpeg,audio/mp4,audio/x-m4a,audio/flac,audio/x-flac,audio/wav,audio/x-wav,.mp3,.m4a,.flac,.wav";

export interface Mp3Tags {
  title: string;
  artist: string;
  album: string;
  albumArtist: string;
  year: string;
  genre: string;
  track: string;
  comment: string;
  cover?: { data: Uint8Array; mime: string; dataUrl: string };
}

export interface Mp3File {
  id: string;
  file: File;
  arrayBuffer: ArrayBuffer;
  format: AudioFormat;
  tags: Mp3Tags;
  original: Mp3Tags;
  dirty: boolean;
}

export const emptyTags = (): Mp3Tags => ({
  title: "",
  artist: "",
  album: "",
  albumArtist: "",
  year: "",
  genre: "",
  track: "",
  comment: "",
});

function u8ToDataUrl(u8: Uint8Array, mime: string): string {
  let bin = "";
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
  return `data:${mime};base64,${btoa(bin)}`;
}

export async function readMp3(file: File): Promise<Mp3File> {
  const arrayBuffer = await file.arrayBuffer();
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
        t.year = String(g.year || "");
        t.genre = g.genre || "";
        t.track = String(g.track || "");
        t.comment = typeof g.comment === "object" ? g.comment?.text || "" : g.comment || "";
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
  return {
    id: crypto.randomUUID(),
    file,
    arrayBuffer,
    format,
    tags,
    original: structuredClone({ ...tags, cover: tags.cover ? { ...tags.cover } : undefined }),
    dirty: false,
  };
}

export function writeTagsToBlob(m: Mp3File): Blob {
  // Only MP3 gets ID3 tags written. Other formats are returned as-is so the
  // user still gets renamed files and can apply edits in-app.
  if (m.format !== "mp3") {
    return new Blob([m.arrayBuffer], { type: m.file.type || "application/octet-stream" });
  }
  const writer = new ID3Writer(m.arrayBuffer.slice(0));
  const t = m.tags;
  if (t.title) writer.setFrame("TIT2", t.title);
  if (t.artist) writer.setFrame("TPE1", [t.artist]);
  if (t.album) writer.setFrame("TALB", t.album);
  if (t.albumArtist) writer.setFrame("TPE2", t.albumArtist);
  if (t.year) writer.setFrame("TYER", parseInt(t.year, 10) || 0);
  if (t.genre) writer.setFrame("TCON", [t.genre]);
  if (t.track) writer.setFrame("TRCK", t.track);
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