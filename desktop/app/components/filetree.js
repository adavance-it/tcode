// Explorer pane — a flattened, expand/collapse file tree. Port of
// src/filetree.ts. The mouse wheel scrolls the viewport only (native overflow
// scroll); the selection moves on keyboard nav or an explicit click.
'use strict';

(function () {
  const path = require('path');
  const TC = (window.TC = window.TC || {});

  class FileTree {
    constructor(bodyEl, paneEl, fileSystem) {
      this.body = bodyEl;
      this.pane = paneEl;
      this.fs = fileSystem;
      this.expanded = new Set([fileSystem.root]);
      this.items = [];
      this.rows = [];
      this.selected = 0;
      this.onOpen = () => {};

      const label = document.getElementById('tree-label');
      if (label) label.textContent = path.basename(fileSystem.root) || fileSystem.root;

      this.pane.addEventListener('keydown', (e) => this.handleKey(e));
      this.rebuild();
    }

    // Rebuild the flat item list from the expanded-set, then re-render.
    rebuild() {
      this.items = [];
      const walk = (dir, depth) => {
        for (const n of this.fs.listDir(dir)) {
          const expanded = n.isDirectory && this.expanded.has(n.path);
          this.items.push({ ...n, depth, expanded });
          if (expanded) walk(n.path, depth + 1);
        }
      };
      walk(this.fs.root, 0);
      this.selected = Math.max(0, Math.min(this.selected, this.items.length - 1));
      this.render();
    }

    render() {
      this.body.innerHTML = '';
      this.rows = [];
      if (!this.items.length) {
        this.body.innerHTML = '<div class="tree-empty">(empty directory)</div>';
        return;
      }
      const frag = document.createDocumentFragment();
      this.items.forEach((it, idx) => {
        const row = document.createElement('div');
        row.className =
          'tree-row ' + (it.isDirectory ? 'dir' : 'file') +
          (idx === this.selected ? ' selected' : '');
        row.style.paddingLeft = 6 + it.depth * 14 + 'px';

        const arrow = document.createElement('span');
        arrow.className = 'tree-arrow';
        arrow.textContent = it.isDirectory ? (it.expanded ? '▾' : '▸') : '';

        const name = document.createElement('span');
        name.className = 'tree-name';
        name.textContent = it.name;

        row.append(arrow, name);
        row.addEventListener('mousedown', (e) => {
          e.preventDefault();
          this.pane.focus();
          this.setSelected(idx, false);
          this.activate(idx);
        });
        frag.appendChild(row);
        this.rows.push(row);
      });
      this.body.appendChild(frag);
    }

    setSelected(idx, scroll = true) {
      idx = Math.max(0, Math.min(idx, this.items.length - 1));
      if (this.rows[this.selected]) this.rows[this.selected].classList.remove('selected');
      this.selected = idx;
      const row = this.rows[idx];
      if (row) {
        row.classList.add('selected');
        if (scroll) row.scrollIntoView({ block: 'nearest' });
      }
    }

    // Enter / click on a row: toggle a directory, open a file.
    activate(idx) {
      const item = this.items[idx];
      if (!item) return;
      if (item.isDirectory) {
        if (this.expanded.has(item.path)) this.expanded.delete(item.path);
        else this.expanded.add(item.path);
        this.rebuild();
        // The toggled directory keeps its row index — selection stays put.
        this.setSelected(idx, false);
      } else {
        this.onOpen(item.path);
      }
    }

    expandCurrent() {
      const item = this.items[this.selected];
      if (item && item.isDirectory && !this.expanded.has(item.path)) {
        this.expanded.add(item.path);
        const idx = this.selected;
        this.rebuild();
        this.setSelected(idx, false);
      }
    }

    collapseCurrent() {
      const item = this.items[this.selected];
      if (!item) return;
      if (item.isDirectory && this.expanded.has(item.path)) {
        this.expanded.delete(item.path);
        const idx = this.selected;
        this.rebuild();
        this.setSelected(idx, false);
      } else {
        const parent = path.dirname(item.path);
        const parentIdx = this.items.findIndex((it) => it.path === parent);
        if (parentIdx >= 0) this.setSelected(parentIdx);
      }
    }

    handleKey(e) {
      const k = e.key;
      if (k === 'ArrowDown' || k === 'j') {
        this.setSelected(this.selected + 1);
      } else if (k === 'ArrowUp' || k === 'k') {
        this.setSelected(this.selected - 1);
      } else if (k === 'Enter' || k === ' ') {
        this.activate(this.selected);
      } else if (k === 'ArrowRight' || k === 'l') {
        this.expandCurrent();
      } else if (k === 'ArrowLeft' || k === 'h') {
        this.collapseCurrent();
      } else if (k === 'g') {
        this.setSelected(0);
      } else if (k === 'G') {
        this.setSelected(this.items.length - 1);
      } else if (k === 'PageDown') {
        this.setSelected(this.selected + 12);
      } else if (k === 'PageUp') {
        this.setSelected(this.selected - 12);
      } else {
        return;
      }
      e.preventDefault();
    }

    focus() {
      this.pane.focus();
    }

    // Expand every ancestor of `filePath` and select that row.
    revealFile(filePath) {
      const rel = path.relative(this.fs.root, filePath);
      if (rel.startsWith('..')) return;
      const parts = rel.split(path.sep);
      let curr = this.fs.root;
      for (let i = 0; i < parts.length - 1; i++) {
        curr = path.join(curr, parts[i]);
        this.expanded.add(curr);
      }
      this.rebuild();
      const idx = this.items.findIndex((it) => it.path === filePath);
      if (idx >= 0) this.setSelected(idx);
    }
  }

  TC.FileTree = FileTree;
})();
