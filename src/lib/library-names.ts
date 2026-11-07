import type { NameEntry } from "./folder-renames";
import { archiveSuffix } from "../../shared/archive-formats.mjs";
export { archiveSuffix };
export const archiveBaseName = (entry: NameEntry) =>
  entry.kind === "archive" ? entry.name.slice(0, -archiveSuffix(entry.name).length) : entry.name;
export const originalArchiveSuffix = (entry: NameEntry) =>
  entry.kind === "archive" ? archiveSuffix(entry.name) : "";
/** Literal text only, including regex punctuation and dollar signs in replacement. */
export function replaceName(name: string, find: string, replacement: string, matchCase: boolean) {
  if (!find) return name;
  if (matchCase) return name.includes(find) ? name.split(find).join(replacement).trim() : name;
  const haystack = name.toLowerCase(),
    needle = find.toLowerCase();
  let cursor = 0,
    result = "",
    index = 0;
  while ((index = haystack.indexOf(needle, cursor)) !== -1) {
    result += name.slice(cursor, index) + replacement;
    cursor = index + find.length;
  }
  // Removing a suffix can leave an extra space that makes the proposed name invalid.
  return cursor ? (result + name.slice(cursor)).trim() : name;
}
