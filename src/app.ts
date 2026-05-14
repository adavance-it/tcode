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
  private splitCol: number;
  private splitRatio: number;
  private draggingSplit = false;

  constructor(root: string, opts: AppOpts = {}) {
    this.fs = new FileSystem(root);
    this.theme = detectTheme(opts.theme ?? 'auto');
    this.screen = blessed.screen({
      smartCSR: true,
      title: 'tcode',
      fullUnicode: true,
      autoPadding: true,
    });

    const w = (this.screen.width as number) || 80;
    this.splitRatio = 0.3;
    this.splitCol = colForRatio(this.splitRatio, w);

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

    this.refreshStatus(null);
    this.wire();
  }

  private refreshStatus(filePath: string | null) {
    const wrapTag = this.viewer.wrap ? '[wrap]' : '[no-wrap]';
    const themeTag = `[${this.theme.mode}]`;
    const sel = this.viewer.selectionRange();
    const selTag = sel ? `[sel ${sel[0]}-${sel[1]}]` : '';
    const left = filePath ? ` ${filePath} ${selTag}` : ' tcode ';
    const right = ` ${themeTag} ${wrapTag} | Tab | ^P search | ^A claude | ^G git | w wrap | d theme | q quit `;
    const total = (this.screen.width as number) || 80;
    const pad = Math.max(1, total - left.length - right.length);
    this.status.setContent(left + ' '.repeat(pad) + right);
  }

  private dimOn() { this.dim.show(); this.dim.setFront(); }
  private dimOff() { this.dim.hide(); }

  private setSplitCol(col: number, opts: { updateRatio?: boolean } = {}) {
    const total = (this.screen.width as number) || 80;
    col = clampSplit(col, total);
    const changed = col !== this.splitCol;
    if (opts.updateRatio !== false && total > 0) this.splitRatio = col / total;
    if (!changed) return;
    this.splitCol = col;
    (this.tree.list as any).width = col;
    (this.viewer.box as any).left = col;
    (this.viewer.box as any).width = total - col;
    (this.splitter as any).left = col;
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
    this.chat.onShow = () => this.dimOn();
    this.chat.onHide = () => this.dimOff();

    this.git.onOpenFile = (p) => {
      this.tree.revealFile(p);
      this.viewer.load(p);
      this.viewer.focus();
    };
    this.git.onShow = () => this.dimOn();
    this.git.onHide = () => this.dimOff();

    // splitter: click+drag to resize
    this.splitter.on('mousedown', () => { this.draggingSplit = true; });
    this.screen.on('mouse', (data: any) => {
      if (!this.draggingSplit) return;
      if (data.action === 'mouseup') { this.draggingSplit = false; return; }
      if (typeof data.x === 'number') this.setSplitCol(data.x);
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

    const openChat = () => {
      if (this.anyModalOpen()) return;
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
    (this.tree.list as any).key(['C-a'], openChat);
    (this.viewer.box as any).key(['C-a'], openChat);
    this.screen.key(['C-a'], openChat);

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
      this.setSplitCol(colForRatio(this.splitRatio, total), { updateRatio: false });
      this.refreshStatus(this.viewer.currentFile);
      this.screen.render();
    });
  }

  private anyModalOpen(): boolean {
    return this.palette.visible || this.chat.visible || this.git.visible;
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
