import * as blessed from 'blessed';
import * as path from 'path';
import { FileSystem, TreeNode } from './files';

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

  constructor(screen: blessed.Widgets.Screen, fs_: FileSystem) {
    this.fs = fs_;
    this.expanded.add(fs_.root);

    this.list = blessed.list({
      parent: screen,
      label: ` ${path.basename(fs_.root)} `,
      top: 0,
      left: 0,
      width: '30%',
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
        track: { bg: 'gray' },
        style: { bg: 'cyan' },
      },
      style: {
        selected: { bg: 'blue', fg: 'white' },
        focus: { border: { fg: 'cyan' } },
        border: { fg: 'gray' },
      },
    });

    this.list.on('select', (_item: any, idx: number) => this.handleEnter(idx));
    this.list.key(['right', 'l'], () => this.expandCurrent());
    this.list.key(['left', 'h'], () => this.collapseCurrent());
    this.list.key(['space'], () => {
      const idx = (this.list as any).selected as number;
      this.handleEnter(idx);
    });

    this.disableMouseScroll();
    this.rebuild();
  }

  // blessed.list's default wheel handler moves the cursor (and thus scrolls).
  // We want wheel to scroll the viewport while keyboard nav drives the cursor.
  private disableMouseScroll() {
    const list: any = this.list;
    for (const ev of ['wheelup', 'wheeldown', 'element wheelup', 'element wheeldown']) {
      list.removeAllListeners(ev);
    }
    this.list.on('element wheelup', () => this.scrollViewport(-3));
    this.list.on('element wheeldown', () => this.scrollViewport(3));

    // Restore childBase if a click ever shifts it (clicks on visible items
    // shouldn't scroll, but trackpads can deliver stray scroll deltas).
    let savedBase = 0;
    this.list.on('mouse', () => {
      savedBase = list.childBase ?? 0;
    });
  }

  private visibleRows(): number {
    const h = (this.list.height as number) || 20;
    return Math.max(1, h - 2); // top/bottom borders
  }

  private scrollViewport(delta: number) {
    const list: any = this.list;
    const visible = this.visibleRows();
    const max = Math.max(0, this.items.length - visible);
    const oldBase = list.childBase ?? 0;
    const newBase = Math.max(0, Math.min(max, oldBase + delta));
    if (newBase === oldBase) return;
    list.childBase = newBase;
    // Keep selection at its absolute index. childOffset is the on-screen row
    // of the cursor; if the selection scrolls offscreen, the cursor highlight
    // disappears until the user scrolls back or moves with the keyboard.
    list.childOffset = (list.selected ?? 0) - newBase;
    this.list.screen.render();
  }

  private rebuild() {
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
      this.list.select(Math.min(idx, this.items.length - 1));
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
      this.list.select(idx);
    }
  }

  private collapseCurrent() {
    const idx = (this.list as any).selected as number;
    const item = this.items[idx];
    if (item?.isDirectory && this.expanded.has(item.path)) {
      this.expanded.delete(item.path);
      this.rebuild();
      this.list.select(idx);
    } else if (item) {
      const parent = path.dirname(item.path);
      const parentIdx = this.items.findIndex(it => it.path === parent);
      if (parentIdx >= 0) this.list.select(parentIdx);
    }
  }

  focus() {
    this.list.focus();
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
