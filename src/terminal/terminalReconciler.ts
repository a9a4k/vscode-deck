import type { AgentStatusDecorationTerminal } from '../agent/agentStatusDecorations';
import { pruneOrder } from '../tree/pruneOrder';
import { classifyObservation, type ObservationTrust } from './observationTrust';
import type { TerminalModel, TerminalModelSession } from './terminalModel';
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
  refreshTerminals(sessions: readonly TerminalModelSession[]): void;
}

export class TerminalReconciler {
  private lastTrust: ObservationTrust | undefined;

  constructor(private readonly options: TerminalReconcilerOptions) {}

  async reconcile(sessions: readonly TmuxSession[]): Promise<void> {
    const trust = classifyObservation(sessions);
    if (trust !== 'restored') {
      // Restore once per trust transition, not per tick: a socket that stays
      // bare (zero Terminals) or down would otherwise re-run the restore
      // machinery — lock, resurrect script — on every 2s observation, forever.
      const transitioned = this.lastTrust !== trust;
      this.lastTrust = trust;
      if (transitioned) await this.options.restoreTerminalSnapshot();
      return;
    }
    this.lastTrust = trust;

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
      if (worktreePath === undefined) continue;
      // Set changes re-resolve the Worktree's rows; a relabel-only diff stays
      // on the targeted per-row path (ADR-0046) so sibling rows never
      // re-render — re-rendering restarts their animated agent icons.
      if (worktreeDiff.added.length > 0 || worktreeDiff.removed.length > 0) {
        this.options.refreshWorktree(worktreePath);
      } else if (worktreeDiff.relabeled.length > 0) {
        this.options.refreshTerminals(worktreeDiff.relabeled);
      }
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
