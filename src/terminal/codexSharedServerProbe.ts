import { createConnection } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type CodexSharedServerState = 'live' | 'absent' | 'unknown';

export class CodexSharedServerProbe {
  constructor(
    private readonly codexHome = process.env.CODEX_HOME || join(homedir(), '.codex'),
    private readonly timeoutMs = 1000,
  ) {}

  probe(): Promise<CodexSharedServerState> {
    const socketPath = join(
      this.codexHome,
      'app-server-control',
      'app-server-control.sock',
    );
    return new Promise((resolve) => {
      const socket = createConnection({ path: socketPath });
      let settled = false;
      const settle = (state: CodexSharedServerState) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve(state);
      };
      socket.setTimeout(this.timeoutMs, () => settle('unknown'));
      socket.once('connect', () => settle('live'));
      socket.once('error', (error) => {
        const code = errorCode(error);
        settle(code === 'ECONNREFUSED' || code === 'ENOENT' ? 'absent' : 'unknown');
      });
    });
  }
}

function errorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error
    ? error.code
    : undefined;
}
