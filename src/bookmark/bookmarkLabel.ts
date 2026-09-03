export function deriveBookmarkLabel(bookmarkUrl: string): string {
  const url = new URL(bookmarkUrl);
  const segments = url.pathname.split('/').filter(Boolean);
  return segments.slice(-2).join('/') || url.host;
}
