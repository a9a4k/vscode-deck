import { describe, expect, it } from 'vitest';
import { ResumeTemplate } from '../src/agent/resumeTemplate';
import type { AgentSidecar } from '../src/agent/agentSidecar';
import { SnapshotRewriter } from '../src/agent/snapshotRewriter';

describe('SnapshotRewriter', () => {
  it('rewrites a Claude pane with a sidecar to its resume command', () => {
    const snapshot = [
      [
        'pane',
        'wt-_work_repo__term-1',
        '0',
        '1',
        ':*',
        '0',
        '%0',
        ':/work/repo',
        '1',
        'claude',
        ':claude',
      ].join('\t'),
      [
        'pane',
        'wt-_work_repo__term-2',
        '0',
        '1',
        ':*',
        '0',
        '%1',
        ':/work/repo',
        '1',
        'zsh',
        ':zsh',
      ].join('\t'),
    ].join('\n');

    const rewritten = new SnapshotRewriter().rewrite(snapshot, new Map([
      ['wt-_work_repo__term-1', sidecar('claude', 'abc-123')],
    ]));

    expect(rewritten.split('\n')).toEqual([
      [
        'pane',
        'wt-_work_repo__term-1',
        '0',
        '1',
        ':*',
        '0',
        '%0',
        ':/work/repo',
        '1',
        'claude',
        ':claude --resume abc-123',
      ].join('\t'),
      [
        'pane',
        'wt-_work_repo__term-2',
        '0',
        '1',
        ':*',
        '0',
        '%1',
        ':/work/repo',
        '1',
        'zsh',
        ':',
      ].join('\t'),
    ]);
  });

  it('resumes a Claude pane from sidecar presence without command-column detection', () => {
    const snapshot = paneLine({
      session: 'wt-_work_repo__term-1',
      currentCommand: '2.1.168',
      fullCommand: ':',
    });

    const rewritten = new SnapshotRewriter().rewrite(snapshot, new Map([
      ['wt-_work_repo__term-1', sidecar('claude', 'abc-123')],
    ]));

    expect(rewritten.split('\t')[10]).toBe(':claude --resume abc-123');
  });

  it('rewrites Codex panes with sidecars to resume commands', () => {
    const snapshot = [
      paneLine({
        session: 'wt-_work_repo__term-1',
        currentCommand: 'zsh',
        fullCommand: ':',
      }),
      paneLine({
        session: 'wt-_work_repo__term-2',
        currentCommand: 'codex-x86_64-a',
        fullCommand: ':codex',
      }),
    ].join('\n');

    const sidecars = new Map<string, AgentSidecar>([
      ['wt-_work_repo__term-1', sidecar('codex', 'codex-123')],
      ['wt-_work_repo__term-2', sidecar('codex', 'codex-456')],
    ]);

    const rewritten = new SnapshotRewriter().rewrite(snapshot, sidecars);

    const lines = rewritten.split('\n');
    expect(lines[0].split('\t')[10]).toBe(':codex --no-daemon resume codex-123');
    expect(lines[1].split('\t')[10]).toBe(':codex --no-daemon resume codex-456');
  });

  it('restores panes without sidecars as plain shells', () => {
    const snapshot = [
      paneLine({ session: 'wt-_work_repo__term-1', currentCommand: 'zsh', fullCommand: ':zsh' }),
      paneLine({ session: 'wt-_work_repo__term-2', currentCommand: 'claude', fullCommand: ':claude' }),
    ].join('\n');

    const rewritten = new SnapshotRewriter().rewrite(snapshot, new Map());

    const lines = rewritten.split('\n');
    expect(lines[0].split('\t')[10]).toBe(':');
    expect(lines[1].split('\t')[10]).toBe(':');
  });

  it('rewrites a Codex pane with a sidecar to its resume command', () => {
    const snapshot = paneLine({
      session: 'wt-_work_repo__term-1',
      currentCommand: 'codex',
      fullCommand: ':codex',
    });

    const rewritten = new SnapshotRewriter().rewrite(snapshot, new Map([
      ['wt-_work_repo__term-1', sidecar('codex', 'codex-123')],
    ]));

    expect(rewritten.split('\t')[10]).toBe(':codex --no-daemon resume codex-123');
  });

  it('uses the Codex resume template when rewriting a pane', () => {
    const snapshot = paneLine({
      session: 'wt-_work_repo__term-1',
      currentCommand: 'codex',
      fullCommand: ':codex',
    });

    const rewritten = new SnapshotRewriter(new ResumeTemplate({
      codex: 'codex --dangerously-bypass-approvals-and-sandbox resume {id}',
    })).rewrite(snapshot, new Map([
      ['wt-_work_repo__term-1', sidecar('codex', 'codex-123')],
    ]));

    expect(rewritten.split('\t')[10]).toBe(
      ':codex --dangerously-bypass-approvals-and-sandbox resume codex-123',
    );
  });

  it('keeps the resume command inside the resurrect tab-delimited command column', () => {
    const snapshot = paneLine({
      session: 'wt-_work_repo__term-1',
      currentCommand: 'claude',
      fullCommand: ':claude',
    });

    const rewritten = new SnapshotRewriter().rewrite(snapshot, new Map([
      ['wt-_work_repo__term-1', sidecar('claude', 'session with spaces')],
    ]));

    const columns = rewritten.split('\t');
    expect(columns).toHaveLength(11);
    expect(columns[10]).toBe(':claude --resume session with spaces');
  });
});

function paneLine(input: {
  session: string;
  currentCommand: string;
  fullCommand: string;
}): string {
  return [
    'pane',
    input.session,
    '0',
    '1',
    ':*',
    '0',
    '%0',
    ':/work/repo',
    '1',
    input.currentCommand,
    input.fullCommand,
  ].join('\t');
}

function sidecar(agent: AgentSidecar['agent'], session_id: string): AgentSidecar {
  return {
    agent,
    session_id,
    pid: 1234,
    startTime: 'Thu Jun 11 20:00:00 2026',
  };
}
