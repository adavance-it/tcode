import * as blessed from 'blessed';
import * as path from 'path';
import { FileSystem, TreeNode } from './files';
import { Theme } from './theme';
import { applyListThemeStyles } from './viewer';
import { wheelScrollsViewportOnly, clickSelectsInPlace } from './listmouse';

interface FlatItem extends TreeNode {
  depth: number;
  expanded: boolean;
}

export class FileTree {
  list: blessed.Widgets.ListElement;
  fs: FileSystem;
  expanded = new Set<string>();
  items: FlatItem[] = [];
  onOpen: (filePath: string) => void = () => {};

  constructor(screen: blessed.Widgets.Screen, fs_: FileSystem, theme: Theme, width: number) {
    this.fs = fs_;
    this.expanded.add(fs_.root);

    this.list = blessed.list({
      parent: screen,
      label: ` ${path.basename(fs_.root)} `,
      top: 0,
      left: 0,
      width,
      height: '100%-1',
      border: 'line',
      keys: true,
      mouse: true,
      vi: true,
      tags: true,
      scrollable: true,
      alwaysScroll: true,
      scrollbar: {
        ch: ' ',
        track: { bg: theme.scrollbarTrackBg },
        style: { bg: theme.scrollbarBg },
      },
      style: {
        selected: { bg: theme.selectedBg, fg: theme.selectedFg },
        focus: { border: { fg: theme.borderFocusFg } },
        border: { fg: theme.borderFg },
      },
    });

    this.list.on('select', (_item: any, idx: number) => this.handleEnter(idx));
    this.list.key(['right', 'l'], () => this.expandCurrent());
    this.list.key(['left', 'h'], () => this.collapseCurrent());
    this.list.key(['space'], () => {
      const idx = (this.list as any).selected as number;
      this.handleEnter(idx);
    });

    // Mouse: wheel scrolls the viewport only; a single click opens the file /
    // toggles the directory, selecting it in place without a scroll jump.
    wheelScrollsViewportOnly(this.list);
    clickSelectsInPlace(this.list, idx => this.handleEnter(idx));
    this.rebuild();
  }

  private rebuild() {
    const list: any = this.list;
    const savedBase = list.childBase ?? 0;
    this.items = [];
    const walk = (dir: string, depth: number) => {
      for (const n of this.fs.listDir(dir)) {
        const expanded = n.isDirectory && this.expanded.has(n.path);
        this.items.push({ ...n, depth, expanded });
        if (expanded) walk(n.path, depth + 1);
      }
    };
    walk(this.fs.root, 0);
    this.list.setItems(this.items.map(i => this.renderItem(i)));
    // setItems can reset the scroll offset; keep the viewport where it was so
    // expanding/collapsing a directory doesn't jump the user around.
    list.childBase = Math.max(0, Math.min(savedBase, this.items.length - 1));
    this.list.screen.render();
  }

  // Move the selection cursor to `idx` without scrolling the viewport.
  private selectInPlace(idx: number) {
    const list: any = this.list;
    const clamped = Math.max(0, Math.min(idx, this.items.length - 1));
    const base = list.childBase ?? 0;
    list.selected = clamped;
    list.childOffset = clamped - base;
    this.list.screen.render();
  }

  private renderItem(i: FlatItem): string {
    const indent = '  '.repeat(i.depth);
    if (i.isDirectory) {
      const arrow = i.expanded ? '▾' : '▸';
      return `${indent}${arrow} {bold}${blessed.escape(i.name)}{/bold}`;
    }
    return `${indent}  ${blessed.escape(i.name)}`;
  }

  private handleEnter(idx: number) {
    const item = this.items[idx];
    if (!item) return;
    if (item.isDirectory) {
      if (this.expanded.has(item.path)) this.expanded.delete(item.path);
      else this.expanded.add(item.path);
      this.rebuild();
      // The toggled directory line stays where it was on screen — no jump.
      this.selectInPlace(idx);
    } else {
      this.onOpen(item.path);
    }
  }

  private expandCurrent() {
    const idx = (this.list as any).selected as number;
    const item = this.items[idx];
    if (item?.isDirectory && !this.expanded.has(item.path)) {
      this.expanded.add(item.path);
      this.rebuild();
      this.selectInPlace(idx);
    }
  }

  private collapseCurrent() {
    const idx = (this.list as any).selected as number;
    const item = this.items[idx];
    if (item?.isDirectory && this.expanded.has(item.path)) {
      this.expanded.delete(item.path);
      this.rebuild();
      this.selectInPlace(idx);
    } else if (item) {
      const parent = path.dirname(item.path);
      const parentIdx = this.items.findIndex(it => it.path === parent);
      // Jumping to the parent is keyboard-driven nav — scroll to it if it's
      // currently off-screen.
      if (parentIdx >= 0) this.list.select(parentIdx);
    }
  }

  focus() {
    this.list.focus();
  }

  applyTheme(theme: Theme) {
    applyListThemeStyles(this.list as any, theme);
    this.list.screen.render();
  }

  revealFile(filePath: string) {
    const rel = path.relative(this.fs.root, filePath);
    if (rel.startsWith('..')) return;
    const parts = rel.split(path.sep);
    let curr = this.fs.root;
    for (let i = 0; i < parts.length - 1; i++) {
      curr = path.join(curr, parts[i]);
      this.expanded.add(curr);
    }
    this.rebuild();
    const idx = this.items.findIndex(it => it.path === filePath);
    if (idx >= 0) this.list.select(idx);
  }
}
