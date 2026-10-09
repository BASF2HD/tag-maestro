export const BATCH_SIZES = [25, 50, 100, 250, 500] as const;
export const DEFAULT_BATCH_SIZE = 25;
export const MAX_BATCH = 500;
export const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
export function savedCoverBatchSize() {
  try {
    const stored =
      typeof window === "undefined"
        ? 0
        : Number(window.localStorage.getItem("coverCleanupBatchSize"));
    return BATCH_SIZES.some((size) => size === stored) ? stored : DEFAULT_BATCH_SIZE;
  } catch {
    return DEFAULT_BATCH_SIZE;
  }
}
