import { describe, expect, it } from 'vitest';
import {
  agentStatusDecorationUri,
  AgentStatusDecorationRollups,
  provideAgentStatusDecoration,
} from '../src/agent/agentStatusDecorations';

describe('provideAgentStatusDecoration', () => {
  it('returns colored dot decorations for attention statuses', () => {
    expect(provideAgentStatusDecoration(agentStatusDecorationUri('term-1'), {
      status: 'needsInput',
      statusAt: 1710000000,
      message: 'Allow Bash(ls)?',
    })).toEqual({
      badge: '•',
      colorId: 'list.warningForeground',
      tooltip: 'Input needed: Allow Bash(ls)?',
    });

    expect(provideAgentStatusDecoration(agentStatusDecorationUri('term-2'), {
      status: 'completed',
      statusAt: 1710000001,
      unread: true,
    })).toEqual({
      badge: '•',
      colorId: 'textLink.foreground',
      tooltip: 'Completed',
    });

    expect(provideAgentStatusDecoration(agentStatusDecorationUri('term-3'), {
      status: 'failed',
      statusAt: 1710000002,
      message: 'API error',
    })).toEqual({
      badge: '•',
      colorId: 'errorForeground',
      tooltip: 'Failed: API error',
    });
  });

  it('returns no decoration for quiet statuses and non-deck URIs', () => {
    expect(provideAgentStatusDecoration(agentStatusDecorationUri('term-1'), {
      status: 'inProgress',
      statusAt: 1710000000,
    })).toBeUndefined();
    expect(provideAgentStatusDecoration(agentStatusDecorationUri('term-2'), {
      status: 'completed',
      statusAt: 1710000001,
      unread: false,
    })).toBeUndefined();
    expect(provideAgentStatusDecoration({ scheme: 'file', path: '/tmp/term-1' }, {
      status: 'needsInput',
      statusAt: 1710000002,
    })).toBeUndefined();
  });
});

describe('AgentStatusDecorationRollups', () => {
  it('invalidates both old and new rollup locations when Terminal locations change', () => {
    const rollups = new AgentStatusDecorationRollups();
    const sessionName = 'wt-_repo_main__term-1';
    rollups.setTerminals([
      {
        repositoryPath: '/old-repo',
        worktreePath: '/old-repo/main',
        sessionName,
      },
    ]);

    expect(rollups.setTerminals([
      {
        repositoryPath: '/new-repo',
        worktreePath: '/new-repo/main',
        sessionName,
      },
    ])).toEqual(expect.arrayContaining([
      expect.objectContaining(agentStatusDecorationUri('terminal', sessionName)),
      expect.objectContaining(agentStatusDecorationUri('worktree', '/old-repo/main')),
      expect.objectContaining(agentStatusDecorationUri('repository', '/old-repo')),
      expect.objectContaining(agentStatusDecorationUri('worktree', '/new-repo/main')),
      expect.objectContaining(agentStatusDecorationUri('repository', '/new-repo')),
    ]));
  });

  it('decorates the closest collapsed ancestor for attention statuses', () => {
    const rollups = new AgentStatusDecorationRollups();
    rollups.setTerminals([
      {
        repositoryPath: '/repo',
        worktreePath: '/repo/main',
        sessionName: 'wt-_repo_main__term-1',
      },
    ]);
    rollups.setStatus('wt-_repo_main__term-1', {
      status: 'needsInput',
      statusAt: 1710000000,
    });

    expect(rollups.getDecorationStatus('terminal', 'wt-_repo_main__term-1')?.status).toBe('needsInput');

    rollups.setCollapsed('worktree', '/repo/main', true);
    expect(rollups.getDecorationStatus('terminal', 'wt-_repo_main__term-1')).toBeUndefined();
    expect(rollups.getDecorationStatus('worktree', '/repo/main')?.status).toBe('needsInput');

    rollups.setCollapsed('repository', '/repo', true);
    expect(rollups.getDecorationStatus('worktree', '/repo/main')).toBeUndefined();
    expect(rollups.getDecorationStatus('repository', '/repo')?.status).toBe('needsInput');
  });

  it('uses the most urgent attention status when a collapsed ancestor has several descendants', () => {
    const rollups = new AgentStatusDecorationRollups();
    rollups.setTerminals([
      {
        repositoryPath: '/repo',
        worktreePath: '/repo/main',
        sessionName: 'completed',
      },
      {
        repositoryPath: '/repo',
        worktreePath: '/repo/main',
        sessionName: 'failed',
      },
      {
        repositoryPath: '/repo',
        worktreePath: '/repo/main',
        sessionName: 'needs-input',
      },
    ]);
    rollups.setStatus('completed', { status: 'completed', statusAt: 1710000000, unread: true });
    rollups.setStatus('failed', { status: 'failed', statusAt: 1710000001 });
    rollups.setStatus('needs-input', { status: 'needsInput', statusAt: 1710000002 });

    rollups.setCollapsed('worktree', '/repo/main', true);

    expect(rollups.getDecorationStatus('worktree', '/repo/main')?.status).toBe('needsInput');

    rollups.setStatus('needs-input', { status: 'inProgress', statusAt: 1710000003 });
    expect(rollups.getDecorationStatus('worktree', '/repo/main')?.status).toBe('failed');
  });

  it('returns targeted invalidation URIs when a rollup node collapses or expands', () => {
    const rollups = new AgentStatusDecorationRollups();
    rollups.setTerminals([
      {
        repositoryPath: '/repo',
        worktreePath: '/repo/main',
        sessionName: 'wt-_repo_main__term-1',
      },
      {
        repositoryPath: '/repo',
        worktreePath: '/repo/main',
        sessionName: 'wt-_repo_main__term-2',
      },
      {
        repositoryPath: '/repo',
        worktreePath: '/repo/other',
        sessionName: 'wt-_repo_other__term-1',
      },
    ]);
    rollups.setStatus('wt-_repo_main__term-1', { status: 'needsInput', statusAt: 1710000000 });
    rollups.setStatus('wt-_repo_main__term-2', { status: 'inProgress', statusAt: 1710000001 });
    rollups.setStatus('wt-_repo_other__term-1', { status: 'failed', statusAt: 1710000002 });

    expect(rollups.invalidationUrisForCollapsedNode('worktree', '/repo/main')).toEqual([
      expect.objectContaining(agentStatusDecorationUri('worktree', '/repo/main')),
      expect.objectContaining(agentStatusDecorationUri('terminal', 'wt-_repo_main__term-1')),
    ]);
  });
});
