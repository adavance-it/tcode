import * as blessed from 'blessed';
import { FileSystem } from './files';
import { FileTree } from './filetree';
import { Viewer, ViewerOpts } from './viewer';
import { CommandPalette } from './palette';
import { ClaudeChat } from './claude';

export interface AppOpts extends ViewerOpts {}

export class App {
  private fs: FileSystem;
  private screen: blessed.Widgets.Screen;
  private tree: FileTree;
  private viewer: Viewer;
  private palette: CommandPalette;
  private chat: ClaudeChat;
  private status: blessed.Widgets.BoxElement;
  private dim: blessed.Widgets.BoxElement;

  constructor(root: string, opts: AppOpts = {}) {
    this.fs = new FileSystem(root);
    this.screen = blessed.screen({
      smartCSR: true,
      title: 'tercode',
      fullUnicode: true,
      autoPadding: true,
    });

    this.tree = new FileTree(this.screen, this.fs);
    this.viewer = new Viewer(this.screen, opts);
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

    // Dim layer used to darken the rest of the screen while a modal is open.
    // Sits above tree/viewer/status, below the modal (modals call setFront on
    // show, which lifts them above this overlay).
    this.dim = blessed.box({
      parent: this.screen,
      hidden: true,
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      style: { bg: 'black', fg: '#3a3a3a' },
      tags: false,
    });

    this.refreshStatus(null);
    this.wire();
  }

  private refreshStatus(filePath: string | null) {
    const wrapTag = this.viewer.wrap ? '[wrap]' : '[no-wrap]';
    const left = filePath ? ` ${filePath} ` : ' tercode ';
    const right = ` ${wrapTag} | Tab switch | Ctrl+P search | Ctrl+A claude | w wrap | q quit `;
    const total = (this.screen.width as number) || 80;
    const pad = Math.max(1, total - left.length - right.length);
    this.status.setContent(left + ' '.repeat(pad) + right);
  }

  private dimOn() {
    this.dim.show();
    this.dim.setFront();
  }

  private dimOff() {
    this.dim.hide();
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
    this.viewer.onWrapChange = () => {
      this.refreshStatus(this.viewer.currentFile);
      this.screen.render();
    };
    this.palette.onSelect = (p) => {
      this.tree.revealFile(p);
      this.viewer.load(p);
      this.viewer.focus();
    };
    this.palette.onShow = () => this.dimOn();
    this.palette.onHide = () => this.dimOff();
    this.chat.onOpenFile = (p, line) => {
      this.tree.revealFile(p);
      this.viewer.load(p, line);
      this.viewer.focus();
    };
    this.chat.onShow = () => this.dimOn();
    this.chat.onHide = () => this.dimOff();

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
