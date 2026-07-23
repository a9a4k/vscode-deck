import { describe, expect, it } from 'vitest';
import { NodeRegistry } from '../src/tree/nodeRegistry';

describe('NodeRegistry', () => {
  it('updates a node in place and reports only render-signature changes', () => {
    const registry = new NodeRegistry<{ label: string }>();

    const first = registry.upsert(
      'repository',
      'alpha',
      () => ({ label: 'alpha' }),
      (node) => {
        node.label = 'alpha';
      },
    );
    const unchanged = registry.upsert(
      'repository',
      'alpha',
      () => ({ label: 'replacement' }),
      (node) => {
        node.label = 'alpha';
      },
    );
    const changed = registry.upsert(
      'repository',
      'alpha (active)',
      () => ({ label: 'replacement' }),
      (node) => {
        node.label = 'alpha (active)';
      },
    );

    expect(unchanged.node).toBe(first.node);
    expect(changed.node).toBe(first.node);
    expect(first.changed).toBe(false);
    expect(unchanged.changed).toBe(false);
    expect(changed.changed).toBe(true);
    expect(changed.node.label).toBe('alpha (active)');
  });

  it('fires before evicting a node', () => {
    const registry = new NodeRegistry<{ label: string }>();
    const { node } = registry.upsert(
      'worktree',
      'main',
      () => ({ label: 'main' }),
      () => undefined,
    );
    const fire = (evicted: { label: string }) => {
      expect(evicted).toBe(node);
      expect(registry.get('worktree')).toBe(node);
    };

    expect(registry.evict('worktree', fire)).toBe(true);

    expect(registry.get('worktree')).toBeUndefined();
    expect(registry.evict('worktree', fire)).toBe(false);
  });
});
