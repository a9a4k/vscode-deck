import { ExecFileCommandRunner, type CommandRunner } from './tmuxCli';

export interface TmuxPreflightResult {
  available: boolean;
  reason?: string;
}

export async function tmuxPreflight(
  runner: CommandRunner = new ExecFileCommandRunner(),
): Promise<TmuxPreflightResult> {
  let stdout: string;
  try {
    const result = await runner.run('tmux', ['-V']);
    if (result.code !== 0) {
      return { available: false, reason: result.stderr || result.stdout || 'tmux not found' };
    }
    stdout = result.stdout.trim();
  } catch {
    return { available: false, reason: 'tmux not found' };
  }

  const match = stdout.match(/(\d+)\.(\d+)/);
  if (!match) return { available: false, reason: `${stdout} is not a supported tmux version` };

  const major = Number(match[1]);
  const minor = Number(match[2]);
  const available = major > 3 || (major === 3 && minor >= 2);
  return available ? { available: true } : { available: false, reason: `${stdout} is older than 3.2` };
}
