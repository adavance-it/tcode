import * as blessed from 'blessed';
import { FileSystem } from './files';
import { FileTree } from './filetree';
import { Viewer, ViewerOpts } from './viewer';
import { CommandPalette } from './palette';
import { ClaudeChat } from './claude';
import { GitExplorer } from './git';
import { Theme, ThemeChoice, detectTheme, DARK, LIGHT } from './theme';

export interface AppOpts extends ViewerOpts {
  theme?: ThemeChoice;
}

const MIN_PANE = 18;

export class App {
  private fs: FileSystem;
  private screen: blessed.Widgets.Screen;
  private theme: Theme;
  private tree: FileTree;
  private viewer: Viewer;
  private palette: CommandPalette;
  private chat: ClaudeChat;
  private git: GitExplorer;
  private status: blessed.Widgets.BoxElement;
  private dim: blessed.Widgets.BoxElement;
  private splitter: blessed.Widgets.BoxElement;
  private chatSplitter: blessed.Widgets.BoxElement;
  private splitCol: number;
  private splitRatio: number;
  private chatCol: number;
  private chatRatio: number;
  private draggingSplit = false;
  private draggingChatSplit = false;

  constructor(root: string, opts: AppOpts = {}) {
    this.fs = new FileSystem(root);
    this.theme = detectTheme(opts.theme ?? 'auto');

    // Force a modern mouse protocol BEFORE the screen is built. blessed's
    // program.enableMouse() only emits the enable sequences for a hardcoded
    // set of TERMs (xterm/screen/rxvt/linux/…) or when terminfo exposes
    // key_mouse — for anything else it silently does nothing and the mouse
    // is dead while the keyboard still works. BLESSED_FORCE_MODES bypasses
    // that detection entirely. SGR mouse (?1006) is understood by every
    // modern terminal (iTerm2, Terminal.app, tmux, kitty, VS Code…).
    if (!process.env.BLESSED_FORCE_MODES) {
      process.env.BLESSED_FORCE_MODES = 'vt200Mouse=1,sgrMouse=1,cellMotion=1,allMotion=1';
    }

    this.screen = blessed.screen({
      smartCSR: true,
      title: 'tcode',
      fullUnicode: true,
      autoPadding: true,
    });
    // Enable mouse explicitly instead of relying on blessed's lazy enablement
    // (which only fires when the first mouse-enabled widget is constructed).
    this.screen.enableMouse();

    const w = (this.screen.width as number) || 80;
    this.splitRatio = 0.3;
    this.chatRatio = 0.35;
    this.splitCol = colForRatio(this.splitRatio, w);
    this.chatCol = w; // chat hidden initially → viewer extends to right edge

    this.tree = new FileTree(this.screen, this.fs, this.theme, this.splitCol);
    this.viewer = new Viewer(this.screen, this.theme, opts);
    (this.viewer.box as any).left = this.splitCol;
    (this.viewer.box as any).width = w - this.splitCol;

    this.palette = new CommandPalette(this.screen, this.fs, this.theme);
    this.chat = new ClaudeChat(this.screen, this.fs.root, this.theme);
    this.git = new GitExplorer(this.screen, this.fs.root, this.theme);

    this.status = blessed.box({
      parent: this.screen,
      bottom: 0,
      left: 0,
      right: 0,
      height: 1,
      tags: false,
      style: { bg: this.theme.statusBg, fg: this.theme.statusFg },
      content: '',
    });

    this.dim = blessed.box({
      parent: this.screen,
      hidden: true,
      top: 0, left: 0, width: '100%', height: '100%',
      style: { bg: this.theme.dimBg },
      tags: false,
    });

    // 1-col mouse target sitting over the gap between tree and viewer.
    this.splitter = blessed.box({
      parent: this.screen,
      top: 0,
      left: this.splitCol,
      width: 1,
      height: '100%-1',
      mouse: true,
      tags: false,
      style: { bg: this.theme.borderFg },
    });

    // 1-col mouse target between viewer and chat panel; hidden until chat is shown.
    this.chatSplitter = blessed.box({
      parent: this.screen,
      hidden: true,
      top: 0,
      left: this.chatCol,
      width: 1,
      height: '100%-1',
      mouse: true,
      tags: false,
      style: { bg: this.theme.borderFg },
    });

    this.refreshStatus(null);
    this.wire();
  }

  private refreshStatus(filePath: string | null) {
    const wrapTag = this.viewer.wrap ? '[wrap]' : '[no-wrap]';
    const themeTag = `[${this.theme.mode}]`;
    const sel = this.viewer.selectionRange();
    const selTag = sel ? `[sel ${sel[0]}-${sel[1]}]` : '';
    const hsTag = this.viewer.hScroll > 0 ? `[→${this.viewer.hScroll}]` : '';
    const left = filePath ? ` ${filePath} ${selTag}${hsTag}` : ' tcode ';
    const right = ` ${themeTag} ${wrapTag} | Tab | ^P search | ^A claude | ^G git | w wrap | d theme | q quit `;
    const total = (this.screen.width as number) || 80;
    const pad = Math.max(1, total - left.length - right.length);
    this.status.setContent(left + ' '.repeat(pad) + right);
  }

  private dimOn() { this.dim.show(); this.dim.setFront(); }
  private dimOff() { this.dim.hide(); }

  private viewerRight(): number {
    return this.chat.visible ? this.chatCol : ((this.screen.width as number) || 80);
  }

  private setSplitCol(col: number, opts: { updateRatio?: boolean } = {}) {
    const total = (this.screen.width as number) || 80;
    const right = this.viewerRight();
    col = clampSplit(col, right);
    const changed = col !== this.splitCol;
    if (opts.updateRatio !== false && total > 0) this.splitRatio = col / total;
    if (!changed) return;
    this.splitCol = col;
    this.applyLayout();
  }

  private setChatCol(col: number, opts: { updateRatio?: boolean } = {}) {
    const total = (this.screen.width as number) || 80;
    // chat must leave at least MIN_PANE for the viewer to its left
    const minChat = this.splitCol + MIN_PANE;
    const maxChat = total - MIN_PANE;
    col = Math.min(Math.max(col, minChat), Math.max(minChat, maxChat));
    const changed = col !== this.chatCol;
    if (opts.updateRatio !== false && total > 0) this.chatRatio = (total - col) / total;
    if (!changed) return;
    this.chatCol = col;
    this.applyLayout();
  }

  private applyLayout() {
    const total = (this.screen.width as number) || 80;
    const right = this.viewerRight();
    (this.tree.list as any).width = this.splitCol;
    (this.viewer.box as any).left = this.splitCol;
    (this.viewer.box as any).width = right - this.splitCol;
    (this.splitter as any).left = this.splitCol;
    if (this.chat.visible) {
      this.chat.setBounds(this.chatCol, total - this.chatCol);
      (this.chatSplitter as any).left = this.chatCol;
      this.chatSplitter.show();
    } else {
      this.chatSplitter.hide();
    }
    this.screen.render();
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
    this.viewer.onHScrollChange = () => {
      this.refreshStatus(this.viewer.currentFile);
      this.screen.render();
    };
    this.viewer.onSelectionChange = () => {
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
    // Chat is an inline pane now — no dim overlay; show/hide drive layout instead.
    this.chat.onShow = () => this.applyLayout();
    this.chat.onHide = () => {
      this.applyLayout();
      this.viewer.focus();
    };
    // Esc inside the chat returns focus to the editor without closing the panel.
    this.chat.onDefocus = () => this.viewer.focus();

    this.git.onOpenFile = (p) => {
      this.tree.revealFile(p);
      this.viewer.load(p);
      this.viewer.focus();
    };
    this.git.onShow = () => this.dimOn();
    this.git.onHide = () => this.dimOff();

    // splitter: click+drag to resize
    this.splitter.on('mousedown', () => { this.draggingSplit = true; });
    this.chatSplitter.on('mousedown', () => { this.draggingChatSplit = true; });
    this.screen.on('mouse', (data: any) => {
      if (data.action === 'mouseup') {
        this.draggingSplit = false;
        this.draggingChatSplit = false;
        return;
      }
      if (typeof data.x !== 'number') return;
      if (this.draggingSplit) this.setSplitCol(data.x);
      else if (this.draggingChatSplit) this.setChatCol(data.x);
    });

    // global keys
    this.screen.key(['C-c'], () => this.quit());
    (this.tree.list as any).key(['q'], () => this.quit());
    (this.viewer.box as any).key(['q'], () => this.quit());

    const switchPane = () => {
      if (this.anyModalOpen()) return;
      const focused = this.screen.focused as any;
      if (focused === (this.tree as any).list) this.viewer.focus();
      else this.tree.focus();
      this.screen.render();
    };
    (this.tree.list as any).key(['tab'], switchPane);
    (this.viewer.box as any).key(['tab'], switchPane);

    const openPalette = () => {
      if (this.anyModalOpen()) return;
      this.palette.show();
    };
    (this.tree.list as any).key(['C-p'], openPalette);
    (this.viewer.box as any).key(['C-p'], openPalette);
    this.screen.key(['C-p'], openPalette);

    const toggleChat = () => {
      if (this.chat.visible) {
        this.chat.hide();
        return;
      }
      // Compute chatCol now that we know the panel is being shown — keeps
      // the saved chatRatio honored even after the user resized the terminal.
      const total = (this.screen.width as number) || 80;
      this.chatCol = chatColForRatio(this.chatRatio, total, this.splitCol);
      const sel = this.viewer.selectionRange();
      if (sel && this.viewer.currentFile) {
        this.chat.show({
          context: {
            file: this.viewer.currentFile,
            range: sel,
            text: this.viewer.selectionText(),
          },
        });
      } else {
        this.chat.show();
      }
    };
    (this.tree.list as any).key(['C-a'], toggleChat);
    (this.viewer.box as any).key(['C-a'], toggleChat);
    this.screen.key(['C-a'], toggleChat);

    const openGit = () => {
      if (this.anyModalOpen()) return;
      this.git.show();
    };
    (this.tree.list as any).key(['C-g'], openGit);
    (this.viewer.box as any).key(['C-g'], openGit);
    this.screen.key(['C-g'], openGit);

    const toggleTheme = () => {
      this.setTheme(this.theme.mode === 'dark' ? LIGHT : DARK);
    };
    this.screen.key(['d', 'S-d'], toggleTheme);

    this.screen.on('resize', () => {
      const total = (this.screen.width as number) || 80;
      this.splitCol = colForRatio(this.splitRatio, total);
      if (this.chat.visible) {
        this.chatCol = chatColForRatio(this.chatRatio, total, this.splitCol);
      } else {
        this.chatCol = total;
      }
      this.applyLayout();
      this.refreshStatus(this.viewer.currentFile);
    });
  }

  private anyModalOpen(): boolean {
    // chat is no longer modal — it's a side pane that coexists with the rest.
    return this.palette.visible || this.git.visible;
  }

  private setTheme(theme: Theme) {
    this.theme = theme;
    this.tree.applyTheme(theme);
    this.viewer.applyTheme(theme);
    this.palette.applyTheme(theme);
    this.chat.applyTheme(theme);
    this.git.applyTheme(theme);
    const sb: any = this.status;
    sb.style = sb.style ?? {};
    sb.style.bg = theme.statusBg;
    sb.style.fg = theme.statusFg;
    const sp: any = this.splitter;
    sp.style = sp.style ?? {};
    sp.style.bg = theme.borderFg;
    const csp: any = this.chatSplitter;
    csp.style = csp.style ?? {};
    csp.style.bg = theme.borderFg;
    const dm: any = this.dim;
    dm.style = dm.style ?? {};
    dm.style.bg = theme.dimBg;
    this.refreshStatus(this.viewer.currentFile);
    this.screen.render();
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

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function clampSplit(col: number, total: number): number {
  if (total < 2 * MIN_PANE) return Math.max(1, Math.floor(total / 2));
  return clamp(col, MIN_PANE, total - MIN_PANE);
}

function colForRatio(ratio: number, total: number): number {
  return clampSplit(Math.round(ratio * total), total);
}

function chatColForRatio(ratio: number, total: number, splitCol: number): number {
  const minChat = splitCol + MIN_PANE;
  const maxChat = total - MIN_PANE;
  const target = Math.round(total * (1 - ratio));
  return Math.min(Math.max(target, minChat), Math.max(minChat, maxChat));
}
