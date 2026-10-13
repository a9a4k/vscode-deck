import { describe, expect, it, vi } from 'vitest';
import { CodexObservationResolver } from '../src/terminal/codexObservationResolver';

describe('CodexObservationResolver', () => {
  it('observes a live Codex AgentSession in the foreground process group', async () => {
    const resolver = new CodexObservationResolver({
      sidecars: {
        read: vi.fn(async () => ({
          agent: 'codex' as const,
          session_id: 'codex-123',
          pid: 222,
          startTime: 'Thu Jun 11 20:00:00 2026',
        })),
      },
      liveness: { isAgentAlive: vi.fn(async () => true) },
      processGroup: vi.fn(async () => 111),
    });

    await expect(resolver.isObserved('term-1', 111)).resolves.toBe(true);
  });

  it.each([
    ['no sidecar', undefined, true, 111, false],
    ['dead sidecar process', codexSidecar(), false, 111, false],
    ['reused sidecar pid', codexSidecar(), false, 111, false],
    ['sidecar in another process group', codexSidecar(), true, 333, false],
    ['npm Codex child in the foreground group', codexSidecar(), true, 111, true],
    ['Claude sidecar', { ...codexSidecar(), agent: 'claude' as const }, true, 111, false],
  ])('%s is classified correctly', async (_name, sidecar, alive, processGroup, expected) => {
    const resolver = new CodexObservationResolver({
      sidecars: { read: vi.fn(async () => sidecar) },
      liveness: { isAgentAlive: vi.fn(async () => alive) },
      processGroup: vi.fn(async () => processGroup),
    });

    await expect(resolver.isObserved('term-1', 111)).resolves.toBe(expected);
  });

  it('treats a failed observation lookup as not observed', async () => {
    const resolver = new CodexObservationResolver({
      sidecars: { read: vi.fn(async () => codexSidecar()) },
      liveness: { isAgentAlive: vi.fn(async () => true) },
      processGroup: vi.fn(async () => { throw new Error('ps failed'); }),
    });

    await expect(resolver.isObserved('term-1', 111)).resolves.toBe(false);
  });
});

function codexSidecar() {
  return {
    agent: 'codex' as const,
    session_id: 'codex-123',
    pid: 222,
    startTime: 'Thu Jun 11 20:00:00 2026',
  };
}
