// Longest suffix first: keep compound extensions intact in both UI and native saves.
export const ARCHIVE_EXTENSIONS = Object.freeze([
  ".tar.bz2",
  ".tar.gz",
  ".tar.xz",
  ".zip",
  ".rar",
  ".7z",
  ".tar",
  ".tgz",
  ".tbz2",
  ".txz",
  ".gz",
  ".bz2",
  ".xz",
]);
export function archiveSuffix(name) {
  const lower = name.toLowerCase();
  const extension = ARCHIVE_EXTENSIONS.find((candidate) => lower.endsWith(candidate));
  return extension ? name.slice(-extension.length) : "";
}
