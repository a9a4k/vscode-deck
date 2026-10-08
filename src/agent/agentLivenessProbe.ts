import { execFile } from 'node:child_process';

export interface AgentProcessIdentity {
  pid: number;
  startTime: string;
}

export interface ProcessProbe {
  isAlive(pid: number): Promise<boolean>;
  children(pid: number): Promise<number[]>;
  startTime(pid: number): Promise<string>;
  command(pid: number): Promise<string>;
  hasControllingTerminal(pid: number): Promise<boolean>;
}

export class AgentLivenessProbe {
  constructor(private readonly processes: ProcessProbe = new PsProcessProbe()) {}

  async isAgentAlive(process: AgentProcessIdentity): Promise<boolean> {
    if (!(await this.processes.isAlive(process.pid))) return false;
    if ((await this.processes.startTime(process.pid)) !== process.startTime) return false;
    try {
      if (!isCodexAppServer(await this.processes.command(process.pid))) return true;
      // A shared server has no controlling tty; a TUI whose args mention app-server does.
      return await this.processes.hasControllingTerminal(process.pid);
    } catch {
      return true;
    }
  }
}

export class PsProcessProbe implements ProcessProbe {
  async isAlive(pid: number): Promise<boolean> {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return error instanceof Error && 'code' in error && error.code === 'EPERM';
    }
  }

  async startTime(pid: number): Promise<string> {
    return this.ps(pid, 'lstart=');
  }

  async command(pid: number): Promise<string> {
    return this.ps(pid, 'command=');
  }

  async hasControllingTerminal(pid: number): Promise<boolean> {
    const tty = await this.ps(pid, 'tty=');
    return tty !== '' && !/^\?+$/.test(tty);
  }

  async children(pid: number): Promise<number[]> {
    return new Promise((resolve) => {
      execFile('pgrep', ['-P', String(pid)], (error, stdout) => {
        if (error) {
          resolve([]);
          return;
        }

        resolve(stdout
          .trim()
          .split('\n')
          .map((line) => Number(line.trim()))
          .filter((childPid) => Number.isInteger(childPid) && childPid > 0));
      });
    });
  }

  private async ps(pid: number, output: string): Promise<string> {
    return new Promise((resolve) => {
      execFile('ps', ['-o', output, '-p', String(pid)], (error, stdout) => {
        resolve(error ? '' : stdout.trim().replace(/\s+/g, ' '));
      });
    });
  }
}

function isCodexAppServer(command: string): boolean {
  return /\bcodex\b.*\bapp-server\b/i.test(command);
}
