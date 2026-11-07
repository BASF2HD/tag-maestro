export type FilenameExtractionMode =
  "before-separator" | "after-separator" | "part" | "before-number" | "after-number" | "characters";

export type FilenameExtractionRule = {
  mode: FilenameExtractionMode;
  separator: string;
  position: number;
  fromEnd: boolean;
  start: number;
  end: number | null;
  trim: boolean;
  trimNumberSeparators: boolean;
};

export const DEFAULT_FILENAME_EXTRACTION: FilenameExtractionRule = {
  mode: "before-separator",
  separator: "-",
  position: 1,
  fromEnd: false,
  start: 1,
  end: null,
  trim: true,
  trimNumberSeparators: true,
};

export function filenameExtractionError(rule: FilenameExtractionRule): string | null {
  if (rule.mode === "characters") {
    if (!Number.isSafeInteger(rule.start) || rule.start < 1)
      return "Start position must be a whole number of 1 or more.";
    if (rule.end !== null && (!Number.isSafeInteger(rule.end) || rule.end < rule.start))
      return "End position must be at or after the start position, or blank.";
  } else {
    if (!Number.isSafeInteger(rule.position) || rule.position < 1)
      return "Position must be a whole number of 1 or more.";
    if (["before-separator", "after-separator", "part"].includes(rule.mode) && !rule.separator)
      return "Enter a separator, such as - or _.";
  }
  return null;
}

/** Extract literal text from the filename, excluding its final extension. No match never clears a tag. */
export function extractFilenameText(filename: string, rule: FilenameExtractionRule): string | null {
  if (filenameExtractionError(rule)) return null;
  const dot = filename.lastIndexOf(".");
  const source = dot > 0 ? filename.slice(0, dot) : filename;
  let value: string;

  if (rule.mode === "characters") {
    // Count visible characters, preserving Tamil combining marks and emoji.
    const characters = Array.from(
      new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(source),
      (part) => part.segment,
    );
    value = characters.slice(rule.start - 1, rule.end ?? undefined).join("");
  } else if (rule.mode === "before-number" || rule.mode === "after-number") {
    const numbers = [...source.matchAll(/\p{Nd}+/gu)];
    const number = numbers[rule.fromEnd ? numbers.length - rule.position : rule.position - 1];
    if (!number) return null;
    value =
      rule.mode === "before-number"
        ? source.slice(0, number.index)
        : source.slice(number.index + number[0].length);
    if (rule.trimNumberSeparators) {
      value =
        rule.mode === "before-number"
          ? value.replace(/[\s\-–—_.,;:|#/\\]+$/u, "")
          : value.replace(/^[\s\-–—_.,;:|#/\\]+/u, "");
    }
  } else {
    // Literal matching makes punctuation such as [, ., + and | safe separators.
    const parts = source.split(rule.separator);
    if (parts.length < 2) return null;
    if (rule.mode === "part") {
      const part = parts[rule.fromEnd ? parts.length - rule.position : rule.position - 1];
      if (part === undefined) return null;
      value = part;
    } else {
      const separatorCount = parts.length - 1;
      if (rule.position > separatorCount) return null;
      const boundary = rule.fromEnd ? parts.length - rule.position : rule.position;
      value =
        rule.mode === "before-separator"
          ? parts.slice(0, boundary).join(rule.separator)
          : parts.slice(boundary).join(rule.separator);
    }
  }
  if (rule.trim) value = value.trim();
  return value.trim() ? value : null;
}
