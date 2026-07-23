export interface NodeRegistryUpsertResult<T> {
  node: T;
  changed: boolean;
}

interface RegisteredNode<T> {
  node: T;
  renderSignature: string;
}

export class NodeRegistry<T> {
  private readonly nodes = new Map<string, RegisteredNode<T>>();

  get(key: string): T | undefined {
    return this.nodes.get(key)?.node;
  }

  *values(): IterableIterator<T> {
    for (const registered of this.nodes.values()) {
      yield registered.node;
    }
  }

  keys(): IterableIterator<string> {
    return this.nodes.keys();
  }

  upsert(
    key: string,
    renderSignature: string,
    create: () => T,
    update: (node: T) => void,
  ): NodeRegistryUpsertResult<T> {
    const existing = this.nodes.get(key);
    if (existing === undefined) {
      const node = create();
      this.nodes.set(key, { node, renderSignature });
      return { node, changed: false };
    }

    update(existing.node);
    const changed = existing.renderSignature !== renderSignature;
    existing.renderSignature = renderSignature;
    return { node: existing.node, changed };
  }

  evict(key: string, beforeEvict: (node: T) => void): boolean {
    const existing = this.nodes.get(key);
    if (existing === undefined) return false;

    beforeEvict(existing.node);
    this.nodes.delete(key);
    return true;
  }
}
