import * as blessed from 'blessed';
import { FileSystem } from './files';
import { FileTree } from './filetree';
import { Viewer } from './viewer';
import { CommandPalette } from './palette';
import { ClaudeChat } from './claude';

export class App {
  private fs: FileSystem;
  private screen: blessed.Widgets.Screen;
  private tree: FileTree;
  private viewer: Viewer;
  private palette: CommandPalette;
  private chat: ClaudeChat;
  private status: blessed.Widgets.BoxElement;

  constructor(root: string) {
    this.fs = new FileSystem(root);
    this.screen = blessed.screen({
      smartCSR: true,
      title: 'tercode',
      fullUnicode: true,
      autoPadding: true,
    });

    this.tree = new FileTree(this.screen, this.fs);
    this.viewer = new Viewer(this.screen);
    this.palette = new CommandPalette(this.screen, this.fs);
    this.chat = new ClaudeChat(this.screen, this.fs.root);

    this.status = blessed.box({
      parent: this.screen,
      bottom: 0,
      left: 0,
      right: 0,
      height: 1,
      tags: false,
      style: { bg: 'blue', fg: 'white' },
      content: '',
    });
    this.refreshStatus(null);

    this.wire();
  }

  private refreshStatus(filePath: string | null) {
    const left = filePath ? ` ${filePath} ` : ' tercode ';
    const right = ' Tab switch | Ctrl+P search | Ctrl+A claude | q quit ';
    const total = (this.screen.width as number) || 80;
    const pad = Math.max(1, total - left.length - right.length);
    this.status.setContent(left + ' '.repeat(pad) + right);
  }

  private wire() {
    this.tree.onOpen = (p) => {
      this.viewer.load(p);
      this.viewer.focus();
    };
    this.viewer.onFileChange = (p) => {
      this.refreshStatus(p);
      this.screen.render();
    };
    this.palette.onSelect = (p) => {
      this.tree.revealFile(p);
      this.viewer.load(p);
      this.viewer.focus();
    };
    this.chat.onOpenFile = (p, line) => {
      this.tree.revealFile(p);
      this.viewer.load(p, line);
      this.viewer.focus();
    };

    // global exit (only when no modal active)
    this.screen.key(['C-c'], () => this.quit());

    // q quits only when focus is on the tree or viewer (so it doesn't kill input boxes)
    (this.tree as any).list.key(['q'], () => this.quit());
    (this.viewer as any).box.key(['q'], () => this.quit());

    // pane switching
    const switchPane = () => {
      if (this.palette.visible || this.chat.visible) return;
      const focused = this.screen.focused as any;
      if (focused === (this.tree as any).list) {
        this.viewer.focus();
      } else {
        this.tree.focus();
      }
      this.screen.render();
    };
    (this.tree as any).list.key(['tab'], switchPane);
    (this.viewer as any).box.key(['tab'], switchPane);

    // command palette
    const openPalette = () => {
      if (this.chat.visible) return;
      this.palette.show();
    };
    (this.tree as any).list.key(['C-p'], openPalette);
    (this.viewer as any).box.key(['C-p'], openPalette);
    this.screen.key(['C-p'], openPalette);

    // claude chat
    const openChat = () => {
      if (this.palette.visible) return;
      this.chat.show();
    };
    (this.tree as any).list.key(['C-a'], openChat);
    (this.viewer as any).box.key(['C-a'], openChat);
    this.screen.key(['C-a'], openChat);

    this.screen.on('resize', () => {
      this.refreshStatus(this.viewer.currentFile);
      this.screen.render();
    });
  }

  private quit() {
    try { this.screen.destroy(); } catch { /* ignore */ }
    process.exit(0);
  }

  run() {
    this.tree.focus();
    this.screen.render();
  }
}
