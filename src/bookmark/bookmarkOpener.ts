const INTEGRATED_BROWSER_COMMAND = 'workbench.action.browser.open';

interface BookmarkNodeLike {
  bookmark: {
    url: string;
  };
}

interface BookmarkOpenRunner {
  getCommands(): PromiseLike<string[]>;
  executeCommand(command: string, argument: unknown): PromiseLike<unknown>;
  openExternal(url: string): PromiseLike<unknown>;
}

export class BookmarkOpener {
  constructor(private readonly runner: BookmarkOpenRunner) {}

  async open(node: BookmarkNodeLike): Promise<void> {
    const commands = await this.runner.getCommands();
    if (commands.includes(INTEGRATED_BROWSER_COMMAND)) {
      await this.runner.executeCommand(INTEGRATED_BROWSER_COMMAND, {
        url: node.bookmark.url,
        reuseUrlFilter: node.bookmark.url,
      });
      return;
    }

    await this.runner.openExternal(node.bookmark.url);
  }

  async openInDefaultBrowser(node: BookmarkNodeLike): Promise<void> {
    await this.runner.openExternal(node.bookmark.url);
  }
}
