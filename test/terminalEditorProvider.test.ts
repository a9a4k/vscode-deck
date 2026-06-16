import { describe, expect, it, vi } from 'vitest';

const cfg = vi.hoisted(() => ({
  editor: { fontFamily: 'JetBrains Mono', fontSize: 15 } as Record<string, unknown>,
  'terminal.integrated': { fontFamily: '', fontSize: 0 } as Record<string, unknown>,
}));

vi.mock('vscode', () => ({
  Uri: {
    joinPath: (base: unknown, ...paths: string[]) => ({ base, paths }),
  },
  workspace: {
    getConfiguration: (section: 'editor' | 'terminal.integrated') => ({
      get: (key: string, defaultValue: unknown) => cfg[section]?.[key] ?? defaultValue,
    }),
    onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
  },
}));

import * as vscode from 'vscode';
import { TerminalEditorProvider } from '../src/terminal/terminalEditorProvider';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function panel() {
  return {
    dispose: vi.fn(),
    title: '',
    visible: true,
    webview: {
      options: {},
      html: '',
      cspSource: 'vscode-resource:',
      asWebviewUri: (uri: unknown) => uri,
      postMessage: vi.fn(async () => true),
      onDidReceiveMessage: vi.fn(() => ({ dispose: vi.fn() })),
    },
    onDidDispose: vi.fn(() => ({ dispose: vi.fn() })),
    onDidChangeViewState: vi.fn(() => ({ dispose: vi.fn() })),
  };
}

function bridge() {
  return {
    start: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    clearHistory: vi.fn(),
    onData: vi.fn(() => ({ dispose: vi.fn() })),
    onExit: vi.fn(() => ({ dispose: vi.fn() })),
    onRename: vi.fn(() => ({ dispose: vi.fn() })),
    dispose: vi.fn(),
  };
}

function providerDocument(
  terminalBridge = bridge(),
  provider = new TerminalEditorProvider(
    { fsPath: '/extension' } as never,
    '/extension/resources/deck.conf',
    undefined,
    () => terminalBridge,
  ),
) {
  return {
    provider,
    document: provider.openCustomDocument({
      scheme: 'deck-terminal',
      path: '/work/alpha-main/term-1',
    } as never),
  };
}

describe('TerminalEditorProvider', () => {
  it('tracks live panels by session and clears them on dispose', () => {
    let disposePanel: (() => void) | undefined;
    const closeSession = vi.fn(async () => undefined);
    const terminalPanel = panel();
    terminalPanel.onDidDispose.mockImplementation((handler: () => void) => {
      disposePanel = handler;
      return { dispose: vi.fn() };
    });
    const terminalBridge = bridge();
    const provider = new TerminalEditorProvider(
      { fsPath: '/extension' } as never,
      '/extension/resources/deck.conf',
      undefined,
      () => terminalBridge,
      closeSession,
    );
    const document = provider.openCustomDocument({
      scheme: 'deck-terminal',
      path: '/work/alpha-main/term-1',
    } as never);

    provider.resolveCustomEditor(document, terminalPanel as never);

    expect(provider.panelFor('wt-_work_alpha-main__term-1')).toBe(terminalPanel);

    disposePanel?.();

    expect(provider.panelFor('wt-_work_alpha-main__term-1')).toBeUndefined();
    expect(closeSession).toHaveBeenCalledWith('wt-_work_alpha-main__term-1');
  });

  it('detaches every live terminal control client when the provider is disposed', () => {
    // Mirror VS Code: disposing a panel fires onDidDispose synchronously, which
    // is what carries the transport teardown through before the host exits.
    const selfFiringPanel = () => {
      const created = panel();
      let onDispose: (() => void) | undefined;
      created.onDidDispose.mockImplementation((handler: () => void) => {
        onDispose = handler;
        return { dispose: vi.fn() };
      });
      created.dispose.mockImplementation(() => onDispose?.());
      return created;
    };

    const bridges: ReturnType<typeof bridge>[] = [];
    const provider = new TerminalEditorProvider(
      { fsPath: '/extension' } as never,
      '/extension/resources/deck.conf',
      undefined,
      () => {
        const created = bridge();
        bridges.push(created);
        return created;
      },
    );

    const panelA = selfFiringPanel();
    const panelB = selfFiringPanel();
    provider.resolveCustomEditor(
      provider.openCustomDocument({ scheme: 'deck-terminal', path: '/work/alpha-main/term-1' } as never),
      panelA as never,
    );
    provider.resolveCustomEditor(
      provider.openCustomDocument({ scheme: 'deck-terminal', path: '/work/beta-main/term-2' } as never),
      panelB as never,
    );
    expect(bridges).toHaveLength(2);

    provider.dispose();

    expect(panelA.dispose).toHaveBeenCalledOnce();
    expect(panelB.dispose).toHaveBeenCalledOnce();
    expect(bridges[0].dispose).toHaveBeenCalledOnce();
    expect(bridges[1].dispose).toHaveBeenCalledOnce();
    expect(provider.panelFor('wt-_work_alpha-main__term-1')).toBeUndefined();
    expect(provider.panelFor('wt-_work_beta-main__term-2')).toBeUndefined();
  });

  it('titles the tab with the resolved Terminal label and updates it on rename', async () => {
    let renameHandler: (() => void) | undefined;
    const terminalBridge = bridge();
    terminalBridge.onRename.mockImplementation((handler: () => void) => {
      renameHandler = handler;
      return { dispose: vi.fn() };
    });
    const terminalSessions = vi.fn(async () => ({
      sessionName: 'wt-_work_alpha-main__term-1',
      windowName: 'zsh',
      paneTitle: ':/work/alpha-main',
    }));
    const terminalPanel = panel();
    const provider = new TerminalEditorProvider(
      { fsPath: '/extension' } as never,
      '/extension/resources/deck.conf',
      undefined,
      () => terminalBridge,
      undefined,
      undefined,
      terminalSessions,
    );
    const document = provider.openCustomDocument({
      scheme: 'deck-terminal',
      path: '/work/alpha-main/term-1',
    } as never);

    provider.resolveCustomEditor(document, terminalPanel as never);
    await flush();
    expect(terminalSessions).toHaveBeenCalledWith('wt-_work_alpha-main__term-1');
    expect(terminalPanel.title).toBe('zsh');
    expect((terminalPanel as { iconPath?: { light: { paths: string[] }; dark: { paths: string[] } } }).iconPath).toEqual({
      light: { base: { fsPath: '/extension' }, paths: ['resources', 'terminal-light.svg'] },
      dark: { base: { fsPath: '/extension' }, paths: ['resources', 'terminal-dark.svg'] },
    });

    terminalSessions.mockResolvedValueOnce({
      sessionName: 'wt-_work_alpha-main__term-1',
      windowName: 'claude',
      paneTitle: '✳ fix tab label',
    });
    renameHandler?.();
    await flush();
    expect(terminalPanel.title).toBe('fix tab label');
    expect((terminalPanel as { iconPath?: { base: { fsPath: string }; paths: string[] } }).iconPath).toEqual({
      base: { fsPath: '/extension' },
      paths: ['resources', 'claude-code.png'],
    });
  });

  it('sets an agent tab icon from the resolved Terminal identity', async () => {
    const terminalSessions = vi.fn(async () => ({
      sessionName: 'wt-_work_alpha-main__term-1',
      windowName: 'claude',
      paneTitle: '✳ fix tab icon',
    }));
    const provider = new TerminalEditorProvider(
      { fsPath: '/extension' } as never,
      '/extension/resources/deck.conf',
      undefined,
      () => bridge(),
      undefined,
      undefined,
      terminalSessions,
    );
    const terminalPanel = panel();
    const document = provider.openCustomDocument({
      scheme: 'deck-terminal',
      path: '/work/alpha-main/term-1',
    } as never);

    provider.resolveCustomEditor(document, terminalPanel as never);
    await flush();

    expect(terminalPanel.title).toBe('fix tab icon');
    expect((terminalPanel as { iconPath?: { base: { fsPath: string }; paths: string[] } }).iconPath).toEqual({
      base: { fsPath: '/extension' },
      paths: ['resources', 'claude-code.png'],
    });
  });

  it('keeps the agent tab icon at identity regardless of agent status', async () => {
    const terminalSessions = vi.fn(async () => ({
      sessionName: 'wt-_work_alpha-main__term-1',
      windowName: 'codex',
      paneTitle: '✳ implement tab icons',
    }));
    const provider = new TerminalEditorProvider(
      { fsPath: '/extension' } as never,
      '/extension/resources/deck.conf',
      undefined,
      () => bridge(),
      undefined,
      undefined,
      terminalSessions,
    );
    const terminalPanel = panel();
    const document = provider.openCustomDocument({
      scheme: 'deck-terminal',
      path: '/work/alpha-main/term-1',
    } as never);

    provider.resolveCustomEditor(document, terminalPanel as never);
    await flush();

    expect((terminalPanel as { iconPath?: { base: { fsPath: string }; paths: string[] } }).iconPath).toEqual({
      base: { fsPath: '/extension' },
      paths: ['resources', 'codex-code.png'],
    });
  });

  it('updates matching agent tab titles on title refresh', async () => {
    const terminalSessions = vi.fn(async () => ({
      sessionName: 'wt-_work_alpha-main__term-1',
      windowName: 'claude',
      paneTitle: '✳ first task',
    }));
    const provider = new TerminalEditorProvider(
      { fsPath: '/extension' } as never,
      '/extension/resources/deck.conf',
      undefined,
      () => bridge(),
      undefined,
      undefined,
      terminalSessions,
      undefined,
    );
    const terminalPanel = panel();
    const document = provider.openCustomDocument({
      scheme: 'deck-terminal',
      path: '/work/alpha-main/term-1',
    } as never);

    provider.resolveCustomEditor(document, terminalPanel as never);
    await flush();
    expect(terminalPanel.title).toBe('first task');

    terminalSessions.mockResolvedValueOnce({
      sessionName: 'wt-_work_alpha-main__term-1',
      windowName: 'claude',
      paneTitle: '✳ second task',
    });
    provider.refreshTitles(['wt-_work_other__term-1']);
    await flush();
    expect(terminalPanel.title).toBe('first task');

    provider.refreshTitles(['wt-_work_alpha-main__term-1']);
    await flush();
    expect(terminalPanel.title).toBe('second task');
  });

  it('does not decorate a hidden Terminal tab, which would steal the active tab', async () => {
    const terminalSessions = vi.fn(async () => ({
      sessionName: 'wt-_work_alpha-main__term-1',
      windowName: 'claude',
      paneTitle: '✳ background task',
    }));
    const provider = new TerminalEditorProvider(
      { fsPath: '/extension' } as never,
      '/extension/resources/deck.conf',
      undefined,
      () => bridge(),
      undefined,
      undefined,
      terminalSessions,
    );
    const terminalPanel = panel();
    terminalPanel.visible = false;
    const document = provider.openCustomDocument({
      scheme: 'deck-terminal',
      path: '/work/alpha-main/term-1',
    } as never);

    provider.resolveCustomEditor(document, terminalPanel as never);
    await flush();
    provider.refreshTitles(['wt-_work_alpha-main__term-1']);
    await flush();

    expect(terminalPanel.title).toBe('');
    expect((terminalPanel as { iconPath?: unknown }).iconPath).toBeUndefined();
  });

  it('decorates a hidden Terminal tab once it becomes visible', async () => {
    const terminalSessions = vi.fn(async () => ({
      sessionName: 'wt-_work_alpha-main__term-1',
      windowName: 'claude',
      paneTitle: '✳ background task',
    }));
    const provider = new TerminalEditorProvider(
      { fsPath: '/extension' } as never,
      '/extension/resources/deck.conf',
      undefined,
      () => bridge(),
      undefined,
      undefined,
      terminalSessions,
    );
    const terminalPanel = panel();
    terminalPanel.visible = false;
    let viewStateHandler: (() => void) | undefined;
    terminalPanel.onDidChangeViewState.mockImplementation((handler: () => void) => {
      viewStateHandler = handler;
      return { dispose: vi.fn() };
    });
    const document = provider.openCustomDocument({
      scheme: 'deck-terminal',
      path: '/work/alpha-main/term-1',
    } as never);

    provider.resolveCustomEditor(document, terminalPanel as never);
    await flush();
    expect(terminalPanel.title).toBe('');

    terminalPanel.visible = true;
    viewStateHandler?.();
    await flush();

    expect(terminalPanel.title).toBe('background task');
  });

  it('disposes the panel when the webview acknowledges terminal exit', () => {
    let receiveMessage: ((message: { type: string }) => void) | undefined;
    let exitBridge: ((code: number) => void) | undefined;
    const terminalPanel = panel();
    terminalPanel.webview.onDidReceiveMessage.mockImplementation(
      (handler: (message: { type: string }) => void) => {
        receiveMessage = handler;
        return { dispose: vi.fn() };
      },
    );
    const terminalBridge = bridge();
    terminalBridge.onExit.mockImplementation((handler: (code: number) => void) => {
      exitBridge = handler;
      return { dispose: vi.fn() };
    });
    const { provider, document } = providerDocument(terminalBridge);

    provider.resolveCustomEditor(document, terminalPanel as never);
    exitBridge?.(0);
    receiveMessage?.({ type: 'exit' });

    expect(terminalPanel.webview.postMessage).toHaveBeenCalledWith({ type: 'exit', code: 0 });
    expect(terminalPanel.dispose).toHaveBeenCalledOnce();
  });

  it('waits for the restore barrier before reattaching, so it never beats restore with a blank session', async () => {
    let receiveMessage: ((message: { type: string; cols?: number; rows?: number }) => void) | undefined;
    const terminalPanel = panel();
    terminalPanel.webview.onDidReceiveMessage.mockImplementation(
      (handler: (message: { type: string }) => void) => {
        receiveMessage = handler;
        return { dispose: vi.fn() };
      },
    );
    const terminalBridge = bridge();
    let releaseRestore!: () => void;
    const restoreBarrier = new Promise<void>((resolve) => {
      releaseRestore = resolve;
    });
    const provider = new TerminalEditorProvider(
      { fsPath: '/extension' } as never,
      '/extension/resources/deck.conf',
      undefined,
      () => terminalBridge,
      undefined,
      undefined,
      undefined,
      () => restoreBarrier,
    );
    const document = provider.openCustomDocument({
      scheme: 'deck-terminal',
      path: '/work/alpha-main/term-1',
    } as never);

    provider.resolveCustomEditor(document, terminalPanel as never);
    receiveMessage?.({ type: 'ready', cols: 80, rows: 24 });
    await flush();
    expect(terminalBridge.start).not.toHaveBeenCalled();

    releaseRestore();
    await flush();
    expect(terminalBridge.start).toHaveBeenCalledOnce();
  });

  it('posts terminal font config when resolving an editor (editor font when terminal font unset)', () => {
    const terminalPanel = panel();
    const { provider, document } = providerDocument();

    provider.resolveCustomEditor(document, terminalPanel as never);

    expect(terminalPanel.webview.postMessage).toHaveBeenCalledWith({
      type: 'config',
      payload: { fontFamily: 'JetBrains Mono', fontSize: 15 },
    });
  });

  it('prefers terminal.integrated font over editor font', () => {
    cfg['terminal.integrated'] = { fontFamily: 'Fira Code', fontSize: 18 };
    try {
      const terminalPanel = panel();
      const { provider, document } = providerDocument();

      provider.resolveCustomEditor(document, terminalPanel as never);

      expect(terminalPanel.webview.postMessage).toHaveBeenCalledWith({
        type: 'config',
        payload: { fontFamily: 'Fira Code', fontSize: 18 },
      });
    } finally {
      cfg['terminal.integrated'] = { fontFamily: '', fontSize: 0 };
    }
  });

  it('broadcasts when a terminal.integrated font setting changes', () => {
    const terminalPanel = panel();
    const { provider, document } = providerDocument();
    provider.resolveCustomEditor(document, terminalPanel as never);
    terminalPanel.webview.postMessage.mockClear();

    const handler = vi.mocked(vscode.workspace.onDidChangeConfiguration).mock.calls.at(-1)?.[0];
    handler?.({
      affectsConfiguration: (section: string) => section === 'terminal.integrated.fontFamily',
    } as never);

    expect(terminalPanel.webview.postMessage).toHaveBeenCalledWith({
      type: 'config',
      payload: expect.objectContaining({ fontFamily: 'JetBrains Mono' }),
    });
  });

  it('rebroadcasts config to live panels when terminal-relevant settings change', () => {
    const terminalPanel = panel();
    const { provider, document } = providerDocument();
    provider.resolveCustomEditor(document, terminalPanel as never);
    terminalPanel.webview.postMessage.mockClear();

    const handler = vi.mocked(vscode.workspace.onDidChangeConfiguration).mock.calls.at(-1)?.[0];
    handler?.({
      affectsConfiguration: (section: string) => section === 'editor.fontSize',
    } as never);

    expect(terminalPanel.webview.postMessage).toHaveBeenCalledWith({
      type: 'config',
      payload: expect.objectContaining({ fontSize: 15 }),
    });
  });

  it('posts find to the active terminal panel', () => {
    const terminalPanel = panel();
    const { provider, document } = providerDocument();
    provider.resolveCustomEditor(document, terminalPanel as never);
    terminalPanel.webview.postMessage.mockClear();

    provider.showFind();

    expect(terminalPanel.webview.postMessage).toHaveBeenCalledWith({ type: 'find' });
  });

  it('renders terminal feel hooks in the webview html', () => {
    const terminalPanel = panel();
    const { provider, document } = providerDocument();

    provider.resolveCustomEditor(document, terminalPanel as never);

    expect(terminalPanel.webview.html).toContain('@xterm/addon-web-links');
    expect(terminalPanel.webview.html).toContain('@xterm/addon-search');
    expect(terminalPanel.webview.html).toContain('@xterm/addon-unicode11');
    expect(terminalPanel.webview.html).toContain('scrollback: 5000');
    expect(terminalPanel.webview.html).toContain("terminal.unicode.activeVersion = '11'");
    // tmux answers DA/DSR for the pane; xterm must not also reply (would leak
    // e.g. '1;2c' to the shell after the querying program exits).
    expect(terminalPanel.webview.html).toContain('registerCsiHandler');
    expect(terminalPanel.webview.html).toContain("{ prefix: '?', final: 'n' }");
    expect(terminalPanel.webview.html).toContain('clipboard.writeText');
    expect(terminalPanel.webview.html).toContain('clipboard.readText');
    expect(terminalPanel.webview.html).toContain('context-menu');
    // Context menu clamps into the viewport so a bottom/right click doesn't clip it.
    expect(terminalPanel.webview.html).toContain('window.innerHeight - contextMenu.offsetHeight');
    expect(terminalPanel.webview.html).toContain('searchAddon.findNext');
    expect(terminalPanel.webview.html).toContain("matchBackground: '#5c3300'");
    expect(terminalPanel.webview.html).not.toContain('rgba(');
  });

  it('renders image-aware paste forwarding while leaving text paste to xterm', () => {
    const terminalPanel = panel();
    const { provider, document } = providerDocument();

    provider.resolveCustomEditor(document, terminalPanel as never);

    expect(terminalPanel.webview.html).toContain("payload: '\\x16'");
    expect(terminalPanel.webview.html).toContain("event.clipboardData?.items || []");
    expect(terminalPanel.webview.html).toContain("item.type.startsWith('image/')");
    expect(terminalPanel.webview.html).toContain("event.preventDefault()");
    // Without stopPropagation, xterm's own paste listener still runs and emits
    // an empty bracketed paste, which Claude Code turns into a second image.
    expect(terminalPanel.webview.html).toContain("event.stopPropagation()");
    expect(terminalPanel.webview.html).toContain("terminalElement.addEventListener('paste'");
    expect(terminalPanel.webview.html).toContain("navigator.clipboard.read()");
    expect(terminalPanel.webview.html).toContain("item.types.some((type) => type.startsWith('image/'))");
    expect(terminalPanel.webview.html).toContain("navigator.clipboard.readText()");
  });

  it('maps Shift+Enter to an ESC+CR newline sequence', () => {
    const terminalPanel = panel();
    const { provider, document } = providerDocument();

    provider.resolveCustomEditor(document, terminalPanel as never);

    // The legacy encoding has no Shift bit on Enter; agents read ESC+CR as a
    // literal newline. The double-escaped source emits '\x1b\r' into the script.
    expect(terminalPanel.webview.html).toContain("event.key === 'Enter'");
    expect(terminalPanel.webview.html).toContain("payload: '\\x1b\\r'");
  });

  it('rejects a duplicate same-session panel without starting a second bridge', () => {
    const firstPanel = panelStub();
    const duplicatePanel = panelStub();
    const firstBridge = bridgeStub();
    const bridgeFactory = vi.fn(() => firstBridge);

    const provider = new TerminalEditorProvider(
      { fsPath: '/extension' } as never,
      '/extension/resources/deck.conf',
      undefined,
      bridgeFactory,
    );
    const document = provider.openCustomDocument({
      scheme: 'deck-terminal',
      path: '/work/alpha-main/term-1',
    } as never);

    provider.resolveCustomEditor(document, firstPanel as never);
    provider.resolveCustomEditor(document, duplicatePanel as never);

    expect(provider.panelFor('wt-_work_alpha-main__term-1')).toBe(firstPanel);
    expect(firstPanel.reveal).toHaveBeenCalledOnce();
    expect(duplicatePanel.dispose).toHaveBeenCalledOnce();
    expect(bridgeFactory).toHaveBeenCalledOnce();
  });

  it('routes input, resize, and clear-history messages to the terminal transport', () => {
    let receiveMessage:
      | ((message: { type: string; cols?: number; rows?: number; payload?: string }) => void)
      | undefined;
    const terminalPanel = panel();
    terminalPanel.webview.onDidReceiveMessage.mockImplementation(
      (handler: (message: { type: string; cols?: number; rows?: number; payload?: string }) => void) => {
        receiveMessage = handler;
        return { dispose: vi.fn() };
      },
    );
    const terminalBridge = bridge();
    const { provider, document } = providerDocument(terminalBridge);

    provider.resolveCustomEditor(document, terminalPanel as never);
    receiveMessage?.({ type: 'input', payload: '\x16' });
    receiveMessage?.({ type: 'resize', cols: 132, rows: 41 });
    receiveMessage?.({ type: 'clearHistory' });

    expect(terminalBridge.write).toHaveBeenCalledWith('\x16');
    expect(terminalBridge.resize).toHaveBeenCalledWith(132, 41);
    // Clear must reach tmux (clear-history) so it survives reload, not just
    // clear the local xterm buffer.
    expect(terminalBridge.clearHistory).toHaveBeenCalledOnce();
  });

  it('does not use webview scrollback snapshots and renders a debounced fit resize observer before ready', () => {
    const panel = panelStub();
    const provider = new TerminalEditorProvider(
      { fsPath: '/extension' } as never,
      '/extension/resources/deck.conf',
      undefined,
      () => bridgeStub(),
    );
    const document = provider.openCustomDocument({
      scheme: 'deck-terminal',
      path: '/work/alpha-main/term-1',
    } as never);

    provider.resolveCustomEditor(document, panel as never);

    expect(panel.webview.html).not.toContain('vscode.getState()');
    expect(panel.webview.html).not.toContain('vscode.setState(');
    expect(panel.webview.html).not.toContain('SerializeAddon');
    expect(panel.webview.html).not.toContain('@xterm/addon-serialize');
    expect(panel.webview.html).toContain('new ResizeObserver');
    expect(panel.webview.html).toContain('setTimeout(postResize, 50)');
    expect(panel.webview.html).toContain("vscode.postMessage({ type: 'resize'");
    expect(panel.webview.html.indexOf("type: 'resize'")).toBeLessThan(
      panel.webview.html.indexOf("type: 'ready'"),
    );
    expect(panel.webview.html).toContain('requestAnimationFrame');
  });
});

function panelStub() {
  return {
    dispose: vi.fn(),
    reveal: vi.fn(),
    title: '',
    visible: true,
    webview: {
      options: {},
      html: '',
      cspSource: 'vscode-resource:',
      asWebviewUri: (uri: unknown) => uri,
      postMessage: vi.fn(async () => true),
      onDidReceiveMessage: vi.fn(() => ({ dispose: vi.fn() })),
    },
    onDidDispose: vi.fn(() => ({ dispose: vi.fn() })),
    onDidChangeViewState: vi.fn(() => ({ dispose: vi.fn() })),
  };
}

function bridgeStub() {
  return {
    start: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    onData: vi.fn(() => ({ dispose: vi.fn() })),
    onExit: vi.fn(() => ({ dispose: vi.fn() })),
    onRename: vi.fn(() => ({ dispose: vi.fn() })),
    dispose: vi.fn(),
  };
}
