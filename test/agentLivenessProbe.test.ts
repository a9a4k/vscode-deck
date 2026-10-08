import { describe, expect, it } from 'vitest';
import { AgentLivenessProbe, type ProcessProbe } from '../src/agent/agentLivenessProbe';

class FakeProcessProbe implements ProcessProbe {
  constructor(
    private readonly process: {
      alive: boolean;
      startTime: string;
      command?: string;
      tty?: boolean;
    },
  ) {}

  async isAlive(): Promise<boolean> {
    return this.process.alive;
  }

  async startTime(): Promise<string> {
    return this.process.startTime;
  }

  async children(): Promise<number[]> {
    return [];
  }

  async command(): Promise<string> {
    if (this.process.command === undefined) throw new Error('command should not be consulted');
    return this.process.command;
  }

  async hasControllingTerminal(): Promise<boolean> {
    if (this.process.tty === undefined) throw new Error('tty should not be consulted');
    return this.process.tty;
  }
}

describe('AgentLivenessProbe', () => {
  it.each([
    ['alive pid', { alive: true, startTime: 'Thu Jun 11 20:00:00 2026', command: '/usr/local/bin/codex' }, true],
    ['Codex app-server', { alive: true, startTime: 'Thu Jun 11 20:00:00 2026', command: '/usr/local/bin/codex app-server --listen unix://', tty: false }, false],
    ['Codex TUI whose prompt mentions app-server', { alive: true, startTime: 'Thu Jun 11 20:00:00 2026', command: 'codex fix the app-server bug', tty: true }, true],
    ['wrapped agent command', { alive: true, startTime: 'Thu Jun 11 20:00:00 2026', command: 'node /opt/codex/bin/codex.js' }, true],
    ['dead pid', { alive: false, startTime: 'Thu Jun 11 20:00:00 2026', command: '/usr/local/bin/codex' }, false],
    ['reused pid', { alive: true, startTime: 'Thu Jun 11 20:01:00 2026', command: '/usr/local/bin/codex' }, false],
    ['command probe failure', { alive: true, startTime: 'Thu Jun 11 20:00:00 2026' }, true],
  ])('%s reports %s', async (_name, process, expected) => {
    const probe = new AgentLivenessProbe(new FakeProcessProbe(process));

    await expect(probe.isAgentAlive({
      pid: 1234,
      startTime: 'Thu Jun 11 20:00:00 2026',
    })).resolves.toBe(expected);
  });
});
