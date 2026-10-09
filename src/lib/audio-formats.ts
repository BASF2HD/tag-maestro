/** Recognised music containers. Playback is codec/browser dependent. */
export const AUDIO_TYPES = {
  mp3: { extensions: [".mp3"], mime: "audio/mpeg" },
  m4a: { extensions: [".m4a", ".m4b", ".mp4"], mime: "audio/mp4" },
  flac: { extensions: [".flac"], mime: "audio/flac" },
  wav: { extensions: [".wav", ".wave"], mime: "audio/wav" },
  aac: { extensions: [".aac", ".adts"], mime: "audio/aac" },
  ogg: { extensions: [".ogg", ".oga"], mime: "audio/ogg" },
  opus: { extensions: [".opus"], mime: "audio/ogg" },
  aiff: { extensions: [".aif", ".aiff", ".aifc"], mime: "audio/aiff" },
  wma: { extensions: [".wma"], mime: "audio/x-ms-wma" },
  ape: { extensions: [".ape"], mime: "audio/x-ape" },
  wv: { extensions: [".wv"], mime: "audio/wavpack" },
  mpc: { extensions: [".mpc", ".mpp", ".mp+"], mime: "audio/x-musepack" },
  tta: { extensions: [".tta"], mime: "audio/x-tta" },
  spx: { extensions: [".spx"], mime: "audio/ogg" },
} as const;

export type AudioFormat = keyof typeof AUDIO_TYPES | "other";
export const SUPPORTED_EXTS: readonly string[] = Object.values(AUDIO_TYPES).flatMap((type) => [
  ...type.extensions,
]);
export const SUPPORTED_ACCEPT = [
  ...new Set(Object.values(AUDIO_TYPES).map((type) => type.mime)),
  "audio/x-flac",
  "audio/x-wav",
  "audio/x-m4a",
  ...SUPPORTED_EXTS,
].join(",");

export function detectFormat(file: Pick<File, "name" | "type">): AudioFormat {
  const name = file.name.toLowerCase();
  for (const [format, type] of Object.entries(AUDIO_TYPES)) {
    if (type.extensions.some((extension) => name.endsWith(extension))) {
      return format as AudioFormat;
    }
  }
  const mime = file.type.toLowerCase();
  const aliases: Record<string, AudioFormat> = {
    "audio/x-flac": "flac",
    "audio/x-wav": "wav",
    "audio/wave": "wav",
    "audio/x-m4a": "m4a",
    "audio/x-aiff": "aiff",
    "audio/x-aac": "aac",
  };
  if (aliases[mime]) return aliases[mime];
  return (
    (Object.entries(AUDIO_TYPES).find(([, type]) => type.mime === mime)?.[0] as AudioFormat) ||
    "other"
  );
}

export function mimeForFormat(format: AudioFormat): string {
  return format === "other" ? "application/octet-stream" : AUDIO_TYPES[format].mime;
}

export function requireTagWritable(format: AudioFormat): void {
  if (format === "aac") {
    throw new Error(
      "Raw AAC/ADTS is available for preview, but tag writing is not supported. Use AAC inside an M4A container for editable metadata.",
    );
  }
  if (format === "other") throw new Error("Unsupported audio format for tag writing");
}
