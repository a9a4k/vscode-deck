export function pruneRowOrder(
  storedOrder: readonly string[],
  liveTerminalKeys: ReadonlySet<string>,
  bookmarkKeys: ReadonlySet<string>,
): { order: readonly string[]; changed: boolean } {
  const order = storedOrder.filter(
    (key) => liveTerminalKeys.has(key) || bookmarkKeys.has(key),
  );
  const changed = order.length !== storedOrder.length;
  return { order: changed ? order : storedOrder, changed };
}
