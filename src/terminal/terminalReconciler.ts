import type { AgentStatusDecorationTerminal } from '../agent/agentStatusDecorations';
import { pruneOrder } from '../tree/pruneOrder';
import { classifyObservation } from './observationTrust';
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
  refreshTerminalDisplays(sessions: readonly TerminalModelSession[]): void;
  onDidAddTerminals(terminals: readonly TerminalModelSession[]): Promise<void> | void;
}

export class TerminalReconciler {
  private untrustedObservationSeen = false;

  constructor(private readonly options: TerminalReconcilerOptions) {}

  async reconcile(sessions: readonly TmuxSession[]): Promise<void> {
    const trust = classifyObservation(sessions);
    if (trust !== 'restored') {
      const restoreRequired = !this.untrustedObservationSeen;
      this.untrustedObservationSeen = true;
      // A failed restore must not latch the episode: the next tick retries,
      // otherwise the tree can never self-heal (a wake reaches this same path,
      // so even Deck: Refresh could not force another attempt).
      if (restoreRequired) {
        try {
          await this.options.restoreTerminalSnapshot();
        } catch (error) {
          this.untrustedObservationSeen = false;
          throw error;
        }
      }
      return;
    }
    this.untrustedObservationSeen = false;

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
    const addedTerminals: TerminalModelSession[] = [];
    for (const worktreeDiff of worktreeDiffs) {
      const worktreePath = worktreePathsBySessionPrefix.get(worktreeDiff.sessionPrefix);
      if (worktreePath === undefined) continue;
      // Set changes re-resolve the Worktree's rows; a relabel-only diff stays
      // on the targeted per-row path (ADR-0046) so sibling rows never
      // re-render — re-rendering restarts their animated agent icons.
      if (worktreeDiff.added.length > 0 || worktreeDiff.removed.length > 0) {
        this.options.refreshWorktree(worktreePath);
        addedTerminals.push(...worktreeDiff.added);
      } else if (worktreeDiff.relabeled.length > 0) {
        this.options.refreshTerminalDisplays(worktreeDiff.relabeled);
      }
    }
    if (addedTerminals.length > 0) {
      await this.options.onDidAddTerminals(addedTerminals);
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
