/** Resolve against the same sorted/filtered order used by playback navigation. */
export function previewPage(tracks: { id: string }[], id: string, pageSize: number) {
  const index = tracks.findIndex((track) => track.id === id);
  return index < 0 ? null : Math.floor(index / Math.max(1, pageSize)) + 1;
}

/** Scroll vertically only, and only when the row is obscured or outside the viewport. */
export function previewScrollTop(
  scrollTop: number,
  viewportTop: number,
  viewportHeight: number,
  headerHeight: number,
  rowTop: number,
  rowBottom: number,
) {
  const top = viewportTop + headerHeight + 4;
  const bottom = viewportTop + viewportHeight - 4;
  if (rowTop >= top && rowBottom <= bottom) return scrollTop;
  return Math.max(0, scrollTop + (rowTop + rowBottom - top - bottom) / 2);
}
