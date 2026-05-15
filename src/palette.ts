import * as blessed from 'blessed';
import * as path from 'path';
import Fuse from 'fuse.js';
import { FileSystem } from './files';
import { Theme } from './theme';
import { applyListThemeStyles } from './viewer';
import { wheelScrollsViewportOnly, clickSelectsInPlace } from './listmouse';

export class CommandPalette {
  private screen: blessed.Widgets.Screen;
  private fs: FileSystem;
  private container: blessed.Widgets.BoxElement;
  private input: blessed.Widgets.TextboxElement;
  private list: blessed.Widgets.ListElement;
  private files: string[] = [];
  private fuse: Fuse<string> | null = null;
  visible = false;
  onSelect: (filePath: string) => void = () => {};
  onShow: () => void = () => {};
  onHide: () => void = () => {};

  constructor(screen: blessed.Widgets.Screen, fs_: FileSystem, theme: Theme) {
    this.screen = screen;
    this.fs = fs_;

    // Show the directory the search is scoped to, so it's always clear that
    // Ctrl+P only walks files under tcode's start directory.
    const scope = path.basename(fs_.root) || fs_.root;
    this.container = blessed.box({
      parent: screen,
      hidden: true,
      top: 'center',
      left: 'center',
      width: '70%',
      height: '60%',
      border: 'line',
      label: ` Search files in ${scope} (Esc to close) `,
      style: {
        border: { fg: theme.modalBorderFg },
      },
      tags: false,
    });

    this.input = blessed.textbox({
      parent: this.container,
      top: 0,
      left: 1,
      right: 1,
      height: 1,
      inputOnFocus: true,
      keys: true,
      mouse: true,
      style: { fg: theme.statusFg },
    });

    this.list = blessed.list({
      parent: this.container,
      top: 2,
      left: 1,
      right: 1,
      bottom: 1,
      keys: false,
      mouse: true,
      tags: false,
      style: {
        selected: { bg: theme.selectedBg, fg: theme.selectedFg },
      },
    });

    this.input.on('keypress', (_ch: string, key: any) => {
      if (!key) return;
      if (key.name === 'escape') {
        this.hide();
        return;
      }
      if (key.name === 'down') {
        this.list.down(1);
        this.screen.render();
        return;
      }
      if (key.name === 'up') {
        this.list.up(1);
        this.screen.render();
        return;
      }
      if (key.name === 'pagedown') {
        this.list.down(10);
        this.screen.render();
        return;
      }
      if (key.name === 'pageup') {
        this.list.up(10);
        this.screen.render();
        return;
      }
      if (key.name === 'enter' || key.name === 'return') {
        // submit handled below
        return;
      }
      setImmediate(() => this.refresh());
    });

    this.input.on('submit', () => this.choose());
    this.input.on('cancel', () => this.hide());

    // Wheel scrolls the result list; a click picks that result.
    wheelScrollsViewportOnly(this.list);
    clickSelectsInPlace(this.list, () => this.choose());
  }

  private ensureIndex() {
    if (this.fuse) return;
    this.files = this.fs
      .walkAllFiles()
      .map(p => path.relative(this.fs.root, p))
      .sort();
    this.fuse = new Fuse(this.files, {
      threshold: 0.4,
      includeScore: true,
      ignoreLocation: true,
    });
  }

  show() {
    this.ensureIndex();
    this.visible = true;
    this.onShow();
    this.container.show();
    this.input.setValue('');
    this.refresh();
    this.input.focus();
    (this.input as any).readInput();
    this.container.setFront();
    this.screen.render();
  }

  hide() {
    if (!this.visible) return;
    this.visible = false;
    (this.input as any).cancel?.();
    this.container.hide();
    this.onHide();
    this.screen.render();
  }

  private refresh() {
    const q = this.input.getValue();
    let results: string[];
    if (!q) {
      results = this.files.slice(0, 200);
    } else {
      results = this.fuse!.search(q).slice(0, 200).map(r => r.item);
    }
    this.list.setItems(results);
    if (results.length) this.list.select(0);
    this.screen.render();
  }

  applyTheme(theme: Theme) {
    const c: any = this.container;
    if (c.style?.border) c.style.border.fg = theme.modalBorderFg;
    applyListThemeStyles(this.list as any, theme);
    this.screen.render();
  }

  private choose() {
    const idx = (this.list as any).selected as number;
    const items = (this.list as any).ritems as string[];
    const rel = items?.[idx];
    if (!rel) {
      this.hide();
      return;
    }
    const full = path.join(this.fs.root, rel);
    this.hide();
    this.onSelect(full);
  }
}
