import type { AgentSidecar } from '../agent/agentSidecar';
import type { AgentProcessIdentity } from '../agent/agentLivenessProbe';

interface CodexObservationResolverOptions {
  sidecars: { read(sessionName: string): Promise<AgentSidecar | undefined> };
  liveness: { isAgentAlive(process: AgentProcessIdentity): Promise<boolean> };
  processGroup(pid: number): Promise<number | undefined>;
}

export class CodexObservationResolver {
  constructor(private readonly options: CodexObservationResolverOptions) {}

  async isObserved(sessionName: string, foregroundProcessGroup: number): Promise<boolean> {
    try {
      const sidecar = await this.options.sidecars.read(sessionName);
      if (sidecar?.agent !== 'codex') return false;
      if (!(await this.options.liveness.isAgentAlive(sidecar))) return false;
      const sidecarProcessGroup = await this.options.processGroup(sidecar.pid);
      return sidecarProcessGroup === foregroundProcessGroup;
    } catch {
      return false;
    }
  }
}
