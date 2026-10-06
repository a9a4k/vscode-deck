import { describe, expect, it, vi } from 'vitest';
import { AgentExitSweep, type AgentExitSidecarStore, type AgentExitStatusStore } from '../src/agent/agentExitSweep';
import { AgentLivenessProbe, type AgentProcessIdentity } from '../src/agent/agentLivenessProbe';
import type { AgentSidecar } from '../src/agent/agentSidecar';
import type { AgentStatus } from '../src/agent/agentStatusStore';

describe('AgentExitSweep', () => {
  it('removes dead agent sidecars, keeps live ones, and no-ops when there are no sidecars', async () => {
    const liveness = vi.fn(async (process: AgentProcessIdentity) => process.pid === 222);
    const sidecars = new SidecarStore([
      ['term-1', sidecar('codex', 'codex-123', 111, 'Thu Jun 11 20:00:00 2026')],
      ['term-2', sidecar('claude', 'claude-123', 222, 'Thu Jun 11 20:00:01 2026')],
    ]);
    const statuses = new StatusStore();
    const teardown = {
      restoreAutomaticRename: vi.fn(async () => undefined),
      renameAgentWindow: vi.fn(async () => undefined),
    };
    const sweep = new AgentExitSweep({
      sidecars,
      statuses,
      liveness: { isAgentAlive: liveness },
      teardown,
    });

    await expect(sweep.runOnce()).resolves.toBe(true);

    expect(liveness).toHaveBeenCalledWith({ pid: 111, startTime: 'Thu Jun 11 20:00:00 2026' });
    expect(liveness).toHaveBeenCalledWith({ pid: 222, startTime: 'Thu Jun 11 20:00:01 2026' });
    expect(teardown.restoreAutomaticRename).toHaveBeenCalledWith('term-1');
    expect(sidecars.removed).toEqual(['term-1']);
    expect(statuses.removed).toEqual(['term-1']);

    sidecars.records = [];
    await expect(sweep.runOnce()).resolves.toBe(false);

    expect(liveness).toHaveBeenCalledTimes(2);
  });

  it('keeps dead sidecars from before the current tmux server lifetime', async () => {
    const liveness = vi.fn(async () => false);
    const sidecars = new SidecarStore([
      ['term-1', sidecar('codex', 'codex-123', 111, 'Thu Jun 11 20:00:00 2026')],
    ]);
    const statuses = new StatusStore();
    const teardown = {
      restoreAutomaticRename: vi.fn(async () => undefined),
      renameAgentWindow: vi.fn(async () => undefined),
    };
    const serverStart = {
      serverStartTime: vi.fn(async () => 'Thu Jun 11 20:01:00 2026'),
    };
    const sweep = new AgentExitSweep({
      sidecars,
      statuses,
      liveness: { isAgentAlive: liveness },
      teardown,
      serverStart,
    });

    await expect(sweep.runOnce()).resolves.toBe(true);

    expect(serverStart.serverStartTime).toHaveBeenCalledOnce();
    expect(sidecars.removed).toEqual([]);
    expect(teardown.restoreAutomaticRename).not.toHaveBeenCalled();
    expect(statuses.removed).toEqual([]);
  });

  it('adopts a dead prior-lifetime sidecar from the live process in its pane', async () => {
    const sidecars = new SidecarStore([
      ['term-1', sidecar('codex', 'codex-123', 111, 'Thu Jun 11 20:00:00 2026')],
    ]);
    const statuses = new StatusStore();
    const teardown = {
      restoreAutomaticRename: vi.fn(async () => undefined),
      renameAgentWindow: vi.fn(async () => undefined),
    };
    const paneProbe = {
      identityForSession: vi.fn(async () => ({
        pid: 333,
        startTime: 'Thu Jun 11 20:02:00 2026',
      })),
    };
    const sweep = new AgentExitSweep({
      sidecars,
      statuses,
      liveness: { isAgentAlive: vi.fn(async () => false) },
      teardown,
      serverStart: {
        serverStartTime: vi.fn(async () => 'Thu Jun 11 20:01:00 2026'),
      },
      paneProbe,
    });

    await expect(sweep.runOnce()).resolves.toBe(true);

    expect(paneProbe.identityForSession).toHaveBeenCalledWith('term-1');
    expect(sidecars.written).toEqual([
      [
        'term-1',
        sidecar('codex', 'codex-123', 333, 'Thu Jun 11 20:02:00 2026'),
      ],
    ]);
    expect(sidecars.removed).toEqual([]);
    expect(teardown.renameAgentWindow).toHaveBeenCalledWith('term-1', 'codex');
    expect(teardown.restoreAutomaticRename).not.toHaveBeenCalled();
    expect(statuses.removed).toEqual([]);
  });

  it('removes an adopted sidecar once its now-current-lifetime process dies', async () => {
    const sidecars = new SidecarStore([
      ['term-1', sidecar('codex', 'codex-123', 111, 'Thu Jun 11 20:00:00 2026')],
    ]);
    const statuses = new StatusStore();
    const teardown = {
      restoreAutomaticRename: vi.fn(async () => undefined),
      renameAgentWindow: vi.fn(async () => undefined),
    };
    // term-1's stored pid is always dead; the pane yields the resumed process on
    // the first sweep, then nothing once the user quits it.
    const liveness = vi.fn(async (process: AgentProcessIdentity) => process.pid === 333);
    const sweep = new AgentExitSweep({
      sidecars,
      statuses,
      liveness: { isAgentAlive: liveness },
      teardown,
      serverStart: {
        serverStartTime: vi.fn(async () => 'Thu Jun 11 20:01:00 2026'),
      },
      paneProbe: {
        identityForSession: vi.fn(async () => ({ pid: 333, startTime: 'Thu Jun 11 20:02:00 2026' })),
      },
    });

    await sweep.runOnce();
    expect(sidecars.written).toEqual([
      ['term-1', sidecar('codex', 'codex-123', 333, 'Thu Jun 11 20:02:00 2026')],
    ]);
    expect(sidecars.removed).toEqual([]);

    // Next tick: the adopted process (333) has been quit, so it is now a dead
    // current-lifetime death and the existing removal path reaps it.
    sidecars.records = [['term-1', sidecar('codex', 'codex-123', 333, 'Thu Jun 11 20:02:00 2026')]];
    liveness.mockResolvedValue(false);

    await sweep.runOnce();
    expect(sidecars.removed).toEqual(['term-1']);
    expect(teardown.restoreAutomaticRename).toHaveBeenCalledWith('term-1');
    expect(statuses.removed).toEqual(['term-1']);
  });

  it('keeps a dead prior-lifetime sidecar untouched when its pane has no live identity', async () => {
    const sidecars = new SidecarStore([
      ['term-1', sidecar('codex', 'codex-123', 111, 'Thu Jun 11 20:00:00 2026')],
    ]);
    const teardown = {
      restoreAutomaticRename: vi.fn(async () => undefined),
      renameAgentWindow: vi.fn(async () => undefined),
    };
    const sweep = new AgentExitSweep({
      sidecars,
      statuses: new StatusStore(),
      liveness: { isAgentAlive: vi.fn(async () => false) },
      teardown,
      serverStart: {
        serverStartTime: vi.fn(async () => 'Thu Jun 11 20:01:00 2026'),
      },
      paneProbe: {
        identityForSession: vi.fn(async () => undefined),
      },
    });

    await expect(sweep.runOnce()).resolves.toBe(true);

    expect(sidecars.written).toEqual([]);
    expect(sidecars.removed).toEqual([]);
    expect(teardown.restoreAutomaticRename).not.toHaveBeenCalled();
  });

  it('does not probe the pane when the stored agent process is still live', async () => {
    const sidecars = new SidecarStore([
      ['term-1', sidecar('claude', 'claude-123', 111, 'Thu Jun 11 20:00:00 2026')],
    ]);
    const paneProbe = {
      identityForSession: vi.fn(async () => ({
        pid: 333,
        startTime: 'Thu Jun 11 20:02:00 2026',
      })),
    };
    const sweep = new AgentExitSweep({
      sidecars,
      statuses: new StatusStore(),
      liveness: { isAgentAlive: vi.fn(async () => true) },
      teardown: { restoreAutomaticRename: vi.fn(async () => undefined), renameAgentWindow: vi.fn(async () => undefined) },
      serverStart: {
        serverStartTime: vi.fn(async () => 'Thu Jun 11 20:01:00 2026'),
      },
      paneProbe,
    });

    await expect(sweep.runOnce()).resolves.toBe(true);

    expect(paneProbe.identityForSession).not.toHaveBeenCalled();
    expect(sidecars.written).toEqual([]);
    expect(sidecars.removed).toEqual([]);
  });

  it('clears a live in-progress agent after its pane is quiescent without removing the sidecar', async () => {
    const sidecars = new SidecarStore([
      ['term-1', sidecar('codex', 'codex-123', 111, 'Thu Jun 11 20:00:00 2026')],
    ]);
    const statuses = new StatusStore([
      ['term-1', { status: 'inProgress', statusAt: 1710000000 }],
    ]);
    const paneCapture = {
      capturePane: vi.fn(async () => 'idle prompt'),
    };
    let now = 1710000000000;
    const sweep = new AgentExitSweep({
      sidecars,
      statuses,
      liveness: { isAgentAlive: vi.fn(async () => true) },
      teardown: { restoreAutomaticRename: vi.fn(async () => undefined), renameAgentWindow: vi.fn(async () => undefined) },
      paneCapture,
      now: () => now,
    });

    await sweep.runOnce();
    now += 5000;
    await sweep.runOnce();
    now += 5000;
    await sweep.runOnce();

    expect(paneCapture.capturePane).toHaveBeenCalledTimes(3);
    expect(paneCapture.capturePane).toHaveBeenCalledWith('term-1');
    expect(statuses.removed).toEqual(['term-1']);
    expect(sidecars.removed).toEqual([]);
  });

  it('keeps a live in-progress agent when its pane keeps changing', async () => {
    const sidecars = new SidecarStore([
      ['term-1', sidecar('claude', 'claude-123', 111, 'Thu Jun 11 20:00:00 2026')],
    ]);
    const statuses = new StatusStore([
      ['term-1', { status: 'inProgress', statusAt: 1710000000 }],
    ]);
    const captures = ['frame 1', 'frame 2', 'frame 3'];
    let now = 1710000000000;
    const sweep = new AgentExitSweep({
      sidecars,
      statuses,
      liveness: { isAgentAlive: vi.fn(async () => true) },
      teardown: { restoreAutomaticRename: vi.fn(async () => undefined), renameAgentWindow: vi.fn(async () => undefined) },
      paneCapture: {
        capturePane: vi.fn(async () => captures.shift()),
      },
      now: () => now,
    });

    await sweep.runOnce();
    now += 5000;
    await sweep.runOnce();
    now += 5000;
    await sweep.runOnce();

    expect(statuses.removed).toEqual([]);
    expect(sidecars.removed).toEqual([]);
  });

  it('does not count a missing pane capture as part of a quiescence window', async () => {
    const sidecars = new SidecarStore([
      ['term-1', sidecar('codex', 'codex-123', 111, 'Thu Jun 11 20:00:00 2026')],
    ]);
    const statuses = new StatusStore([
      ['term-1', { status: 'inProgress', statusAt: 1710000000 }],
    ]);
    const captures = ['idle prompt', undefined, 'idle prompt'];
    let now = 1710000000000;
    const sweep = new AgentExitSweep({
      sidecars,
      statuses,
      liveness: { isAgentAlive: vi.fn(async () => true) },
      teardown: { restoreAutomaticRename: vi.fn(async () => undefined), renameAgentWindow: vi.fn(async () => undefined) },
      paneCapture: {
        capturePane: vi.fn(async () => captures.shift()),
      },
      now: () => now,
    });

    await sweep.runOnce();
    now += 5000;
    await sweep.runOnce();
    now += 5000;
    await sweep.runOnce();

    expect(statuses.removed).toEqual([]);
    expect(sidecars.removed).toEqual([]);
  });

  it('does not capture or clear live agents outside in-progress status', async () => {
    const sidecars = new SidecarStore([
      ['term-1', sidecar('codex', 'codex-123', 111, 'Thu Jun 11 20:00:00 2026')],
      ['term-2', sidecar('claude', 'claude-123', 222, 'Thu Jun 11 20:00:01 2026')],
    ]);
    const statuses = new StatusStore([
      ['term-1', { status: 'needsInput', statusAt: 1710000000 }],
      ['term-2', { status: 'completed', statusAt: 1710000001 }],
    ]);
    const paneCapture = {
      capturePane: vi.fn(async () => 'static prompt'),
    };
    const sweep = new AgentExitSweep({
      sidecars,
      statuses,
      liveness: { isAgentAlive: vi.fn(async () => true) },
      teardown: { restoreAutomaticRename: vi.fn(async () => undefined), renameAgentWindow: vi.fn(async () => undefined) },
      paneCapture,
    });

    await sweep.runOnce();

    expect(paneCapture.capturePane).not.toHaveBeenCalled();
    expect(statuses.removed).toEqual([]);
    expect(sidecars.removed).toEqual([]);
  });

  it('removes dead sidecars from the current tmux server lifetime', async () => {
    const sidecars = new SidecarStore([
      ['term-1', sidecar('claude', 'claude-123', 111, 'Thu Jun 11 20:01:00 2026')],
    ]);
    const statuses = new StatusStore();
    const teardown = {
      restoreAutomaticRename: vi.fn(async () => undefined),
      renameAgentWindow: vi.fn(async () => undefined),
    };
    const sweep = new AgentExitSweep({
      sidecars,
      statuses,
      liveness: { isAgentAlive: vi.fn(async () => false) },
      teardown,
      serverStart: {
        serverStartTime: vi.fn(async () => 'Thu Jun 11 20:00:00 2026'),
      },
    });

    await expect(sweep.runOnce()).resolves.toBe(true);

    expect(teardown.restoreAutomaticRename).toHaveBeenCalledWith('term-1');
    expect(sidecars.removed).toEqual(['term-1']);
    expect(statuses.removed).toEqual(['term-1']);
  });

  it('removes a sidecar and status that point at a Codex app-server', async () => {
    const startTime = 'Thu Jun 11 20:01:00 2026';
    const sidecars = new SidecarStore([
      ['term-1', sidecar('codex', 'codex-123', 111, startTime)],
    ]);
    const statuses = new StatusStore([
      ['term-1', { status: 'inProgress', statusAt: 1710000000, agent: 'codex' }],
    ]);
    const sweep = new AgentExitSweep({
      sidecars,
      statuses,
      liveness: new AgentLivenessProbe({
        isAlive: async () => true,
        children: async () => [],
        startTime: async () => startTime,
        command: async () => '/usr/local/bin/codex app-server --listen unix://',
      }),
      teardown: {
        restoreAutomaticRename: async () => undefined,
        renameAgentWindow: async () => undefined,
      },
      serverStart: {
        serverStartTime: async () => 'Thu Jun 11 20:00:00 2026',
      },
    });

    await sweep.runOnce();

    expect(sidecars.removed).toEqual(['term-1']);
    expect(statuses.removed).toEqual(['term-1']);
  });

  it('reads the server start time at most once per sweep regardless of dead sidecar count', async () => {
    const sidecars = new SidecarStore([
      ['term-1', sidecar('claude', 'claude-1', 111, 'Thu Jun 11 20:01:00 2026')],
      ['term-2', sidecar('codex', 'codex-2', 222, 'Thu Jun 11 20:02:00 2026')],
      ['term-3', sidecar('claude', 'claude-3', 333, 'Thu Jun 11 20:03:00 2026')],
    ]);
    const serverStart = {
      serverStartTime: vi.fn(async () => 'Thu Jun 11 20:00:00 2026'),
    };
    const sweep = new AgentExitSweep({
      sidecars,
      statuses: new StatusStore(),
      liveness: { isAgentAlive: vi.fn(async () => false) },
      teardown: { restoreAutomaticRename: vi.fn(async () => undefined), renameAgentWindow: vi.fn(async () => undefined) },
      serverStart,
    });

    await sweep.runOnce();

    expect(serverStart.serverStartTime).toHaveBeenCalledOnce();
    expect(sidecars.removed).toEqual(['term-1', 'term-2', 'term-3']);
  });
});

class SidecarStore implements AgentExitSidecarStore {
  removed: string[] = [];
  written: Array<[string, AgentSidecar]> = [];

  constructor(public records: Array<[string, AgentSidecar]>) {}

  async readAll(): Promise<Map<string, AgentSidecar>> {
    return new Map(this.records);
  }

  async remove(sessionName: string): Promise<void> {
    this.removed.push(sessionName);
  }

  async write(sessionName: string, sidecar: AgentSidecar): Promise<void> {
    this.written.push([sessionName, sidecar]);
  }
}

class StatusStore implements AgentExitStatusStore {
  removed: string[] = [];

  constructor(private readonly records: Array<[string, AgentStatus]> = []) {}

  get(sessionName: string): AgentStatus | undefined {
    return new Map(this.records).get(sessionName);
  }

  async remove(sessionName: string): Promise<void> {
    this.removed.push(sessionName);
  }
}

function sidecar(agent: AgentSidecar['agent'], session_id: string, pid: number, startTime: string): AgentSidecar {
  return {
    agent,
    session_id,
    pid,
    startTime,
  };
}
