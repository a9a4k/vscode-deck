import type { AgentStatusDecorationTerminal } from '../agent/agentStatusDecorations';
import { pruneOrder } from '../tree/pruneOrder';
import { classifyObservation } from './observationTrust';
import type { TerminalModel } from './terminalModel';
import type { TmuxSession } from './tmuxCli';
import { terminalSessionPrefix } from './tmuxSafe';

export interface TerminalLocation {
  repositoryPath: string;
  worktreePath: string;
}

interface TerminalOrderWriter {
  get(worktreePath: string): readonly string[] | undefined;
  set(worktreePath: string, order: readonly string[]): Promise<void>;
}

interface TerminalReconcilerOptions {
  model: TerminalModel;
  restoreTerminalSnapshot(): Promise<void>;
  terminalOrders: TerminalOrderWriter;
  listTerminalLocations(): readonly TerminalLocation[];
  updateTerminalDecorations(terminals: readonly AgentStatusDecorationTerminal[]): void;
  wakeAgentExitSweep(): void;
  refreshWorktree(worktreePath: string): void;
}

export class TerminalReconciler {
  constructor(private readonly options: TerminalReconcilerOptions) {}

  async reconcile(sessions: readonly TmuxSession[]): Promise<void> {
    const trust = classifyObservation(sessions);
    if (trust !== 'restored') {
      await this.options.restoreTerminalSnapshot();
      return;
    }

    const worktreeDiffs = this.options.model.apply(sessions);
    const locations = uniqueLocations(this.options.listTerminalLocations());
    await this.pruneTerminalOrders(locations);
    this.options.updateTerminalDecorations(decorationTerminals(this.options.model, locations));

    if (worktreeDiffs.some((worktreeDiff) => worktreeDiff.removed.length > 0)) {
      this.options.wakeAgentExitSweep();
    }
    const worktreePathsBySessionPrefix = new Map(
      locations.map((location) => [terminalSessionPrefix(location.worktreePath), location.worktreePath]),
    );
    for (const worktreeDiff of worktreeDiffs) {
      const worktreePath = worktreePathsBySessionPrefix.get(worktreeDiff.sessionPrefix);
      if (worktreePath !== undefined) this.options.refreshWorktree(worktreePath);
    }
  }

  private async pruneTerminalOrders(locations: readonly TerminalLocation[]): Promise<void> {
    for (const location of locations) {
      const order = this.options.terminalOrders.get(location.worktreePath);
      if (order === undefined) continue;
      const liveSessionNames = new Set(
        this.options.model.get(location.worktreePath).map((terminal) => terminal.sessionName),
      );
      const pruned = pruneOrder(order, liveSessionNames);
      if (pruned.changed) {
        await this.options.terminalOrders.set(location.worktreePath, pruned.order);
      }
    }
  }
}

function uniqueLocations(locations: readonly TerminalLocation[]): TerminalLocation[] {
  return [...new Map(locations.map((location) => [location.worktreePath, location])).values()];
}

function decorationTerminals(
  model: TerminalModel,
  locations: readonly TerminalLocation[],
): AgentStatusDecorationTerminal[] {
  return locations.flatMap((location) =>
    model.get(location.worktreePath).map((terminal) => ({
      repositoryPath: location.repositoryPath,
      worktreePath: location.worktreePath,
      sessionName: terminal.sessionName,
    })));
}
