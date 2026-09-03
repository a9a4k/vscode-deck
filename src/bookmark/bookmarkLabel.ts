export function deriveBookmarkLabel(bookmarkUrl: string): string {
  const url = new URL(bookmarkUrl);
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length === 0) return url.host;
  return segments.slice(-2).join('/');
}
