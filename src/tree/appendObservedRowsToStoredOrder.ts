export function appendObservedRowsToStoredOrder(
  storedOrder: readonly string[] | undefined,
  observedRows: readonly { key: string }[],
): string[] {
  const rowOrder = [...(storedOrder ?? [])];
  const includedKeys = new Set(rowOrder);
  for (const row of observedRows) {
    if (includedKeys.has(row.key)) continue;
    rowOrder.push(row.key);
    includedKeys.add(row.key);
  }
  return rowOrder;
}
