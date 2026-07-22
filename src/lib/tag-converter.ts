import type { Mp3File, Mp3Tags } from "@/lib/mp3";

export type ConverterTagKey = keyof Omit<Mp3Tags, "cover">;

export const CONVERTER_FIELDS: Array<{ key: ConverterTagKey; label: string }> = [
  { key: "title", label: "Title" },
  { key: "artist", label: "Artist" },
  { key: "album", label: "Album" },
  { key: "albumArtist", label: "Album Artist" },
  { key: "composer", label: "Composer" },
  { key: "year", label: "Year" },
  { key: "tag", label: "Tag" },
  { key: "genre", label: "Genre" },
  { key: "discnumber", label: "Discnumber" },
  { key: "track", label: "Track" },
  { key: "comment", label: "Comment" },
  { key: "bpm", label: "BPM" },
];

const FIELD_ALIASES: Record<string, ConverterTagKey> = {
  title: "title",
  artist: "artist",
  album: "album",
  albumartist: "albumArtist",
  album_artist: "albumArtist",
  composer: "composer",
  year: "year",
  date: "year",
  tag: "tag",
  grouping: "tag",
  genre: "genre",
  disc: "discnumber",
  discnumber: "discnumber",
  track: "track",
  tracknumber: "track",
  comment: "comment",
  bpm: "bpm",
};

export const FORMAT_PLACEHOLDERS = [
  "%track%",
  "%title%",
  "%artist%",
  "%album%",
  "%albumartist%",
  "%year%",
  "%genre%",
  "%discnumber%",
  "%composer%",
  "%comment%",
  "%bpm%",
  "%filename%",
  "%folder%",
  "%dummy%",
] as const;

function filenameParts(name: string) {
  const dot = name.lastIndexOf(".");
  return dot > 0
    ? { base: name.slice(0, dot), extension: name.slice(dot + 1) }
    : { base: name, extension: "" };
}

function placeholderValue(file: Mp3File, name: string): string {
  const normalized = name.toLowerCase();
  const field = FIELD_ALIASES[normalized];
  if (field) return file.tags[field] || "";

  const { base, extension } = filenameParts(file.file.name);
  switch (normalized) {
    case "filename":
    case "_filename":
      return base;
    case "filename_ext":
    case "_filename_ext":
      return file.file.name;
    case "extension":
      return extension;
    case "folder":
    case "directory":
    case "_directory":
      return file.editedFolderName || file.folderName;
    case "path":
    case "_path":
      return file.meta.path;
    default:
      return "";
  }
}

export function formatTagTemplate(file: Mp3File, template: string): string {
  const numbered = template.replace(
    /\$num\(\s*(%[a-z_]+%)\s*,\s*(\d+)\s*\)/gi,
    (_match, placeholder: string, widthText: string) => {
      const value = placeholderValue(file, placeholder.slice(1, -1));
      const firstNumber = value.split("/", 1)[0].trim();
      return firstNumber.padStart(Math.max(1, Number(widthText) || 1), "0");
    },
  );
  return numbered.replace(/%([a-z_]+)%/gi, (_match, name: string) => placeholderValue(file, name));
}

function escapePatternLiteral(value: string): string {
  return value
    .split(/\s+/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+");
}

function sourceName(file: Mp3File, includeFolders: boolean): string {
  if (!includeFolders) return filenameParts(file.file.name).base;
  const normalized = (file.meta.path || file.file.name).replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length > 1) parts.shift();
  const relative = parts.join("/");
  const slash = relative.lastIndexOf("/");
  const name = slash >= 0 ? relative.slice(slash + 1) : relative;
  const withoutExtension = filenameParts(name).base;
  return slash >= 0 ? `${relative.slice(0, slash + 1)}${withoutExtension}` : withoutExtension;
}

export function parseFilenameTemplate(
  file: Mp3File,
  template: string,
): Partial<Record<ConverterTagKey, string>> | null {
  const normalizedTemplate = template.replace(/\\/g, "/").trim();
  if (!normalizedTemplate) return null;

  const tokenPattern = /%([a-z_]+)%/gi;
  const tokens = [...normalizedTemplate.matchAll(tokenPattern)];
  if (!tokens.length) return null;

  let cursor = 0;
  let expression = "^";
  const fields: Array<ConverterTagKey | null> = [];
  for (const token of tokens) {
    const index = token.index ?? 0;
    expression += escapePatternLiteral(normalizedTemplate.slice(cursor, index));
    expression += "(.+?)";
    const name = token[1].toLowerCase();
    fields.push(name === "dummy" ? null : (FIELD_ALIASES[name] ?? null));
    cursor = index + token[0].length;
  }
  expression += escapePatternLiteral(normalizedTemplate.slice(cursor));
  expression += "$";

  const includeFolders = normalizedTemplate.includes("/");
  const match = new RegExp(expression, "i").exec(sourceName(file, includeFolders));
  if (!match) return null;

  const values: Partial<Record<ConverterTagKey, string>> = {};
  fields.forEach((field, index) => {
    if (field) values[field] = match[index + 1].trim();
  });
  return values;
}

export function sanitizeFilenameBase(value: string, fallback: string): string {
  const safe = value
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/[. ]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return safe || fallback;
}
