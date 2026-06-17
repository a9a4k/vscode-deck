export interface RevealRetryOptions {
  attempts?: number;
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

// A Terminal opened from the launcher fires its tab-change reveal *before* the
// post-create tree refresh has populated VS Code's tree model, so reveal()
// rejects with "Cannot resolve tree item". The refresh lands a few ms later;
// retry until the node becomes resolvable. Returns whether a reveal succeeded.
export async function revealWithRetry(
  reveal: () => PromiseLike<void>,
  options: RevealRetryOptions = {},
): Promise<boolean> {
  const attempts = options.attempts ?? 6;
  const delayMs = options.delayMs ?? 50;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await reveal();
      return true;
    } catch {
      if (attempt === attempts - 1) return false;
      await sleep(delayMs);
    }
  }
  return false;
}
