// Cmd/Ctrl+P fuzzy file search modal.
'use strict';

(function () {
  const path = require('path');
  const FuseModule = require('fuse.js');
  const Fuse = FuseModule.default || FuseModule;
  const TC = (window.TC = window.TC || {});

  class CommandPalette {
    constructor(modalEl, fileSystem) {
      this.modal = modalEl;
      this.fs = fileSystem;
      this.files = [];
      this.fuse = null;
      this.results = [];
      this.rows = [];
      this.selected = 0;
      this.visible = false;
      this.onSelect = () => {};
      this.onShow = () => {};
      this.onHide = () => {};

      const scope = path.basename(fileSystem.root) || fileSystem.root;
      this.modal.innerHTML =
        `<div class="modal-head">Search files in ${TC.escapeHtml(scope)} — Esc to close</div>` +
        `<div class="pal-input-wrap"><input class="pal-input" type="text" ` +
        `spellcheck="false" placeholder="Type to fuzzy-search files…" /></div>` +
        `<div class="pal-list"></div>` +
        `<div class="pal-count"></div>`;
      this.head = this.modal.querySelector('.modal-head');
      this.input = this.modal.querySelector('.pal-input');
      this.list = this.modal.querySelector('.pal-list');
      this.count = this.modal.querySelector('.pal-count');

      this.input.addEventListener('keydown', (e) => this._key(e));
      this.input.addEventListener('input', () => this.refresh());
    }

    // Point the search at a different root directory.
    setRoot(fileSystem) {
      this.fs = fileSystem;
      this.invalidate();
      const scope = path.basename(fileSystem.root) || fileSystem.root;
      if (this.head) this.head.textContent = `Search files in ${scope} — Esc to close`;
    }

    // Drop the cached file index so it is rebuilt on next open (after a pull,
    // clone or root change).
    invalidate() {
      this.fuse = null;
      this.files = [];
      this.results = [];
      this.selected = 0;
    }

    _ensureIndex() {
      if (this.fuse) return;
      this.files = this.fs
        .walkAllFiles()
        .map((p) => path.relative(this.fs.root, p))
        .sort();
      this.fuse = new Fuse(this.files, {
        threshold: 0.4,
        includeScore: true,
        ignoreLocation: true,
      });
    }

    show() {
      this._ensureIndex();
      this.visible = true;
      this.onShow();
      this.modal.classList.remove('hidden');
      this.input.value = '';
      this.refresh();
      this.input.focus();
    }

    hide() {
      if (!this.visible) return;
      this.visible = false;
      this.modal.classList.add('hidden');
      this.onHide();
    }

    refresh() {
      const q = this.input.value.trim();
      this.results = q
        ? this.fuse.search(q).slice(0, 200).map((r) => r.item)
        : this.files.slice(0, 200);
      this.selected = 0;
      this._render();
    }

    _render() {
      this.list.innerHTML = '';
      this.rows = [];
      if (!this.results.length) {
        this.list.innerHTML = '<div class="pal-empty">(no matching files)</div>';
        this.count.textContent = '0 files';
        return;
      }
      const frag = document.createDocumentFragment();
      this.results.forEach((rel, idx) => {
        const dir = path.dirname(rel);
        const base = path.basename(rel);
        const row = document.createElement('div');
        row.className = 'pal-row' + (idx === this.selected ? ' selected' : '');
        const dirSpan = document.createElement('span');
        dirSpan.className = 'pal-dir';
        dirSpan.textContent = dir === '.' ? '' : dir + path.sep;
        const baseSpan = document.createElement('span');
        baseSpan.className = 'pal-base';
        baseSpan.textContent = base;
        row.append(dirSpan, baseSpan);
        row.addEventListener('mousedown', (e) => {
          e.preventDefault();
          this.selected = idx;
          this.choose();
        });
        frag.appendChild(row);
        this.rows.push(row);
      });
      this.list.appendChild(frag);
      this.count.textContent =
        `${this.results.length}${this.results.length >= 200 ? '+' : ''} files`;
    }

    _setSelected(idx) {
      if (!this.results.length) return;
      idx = Math.max(0, Math.min(idx, this.results.length - 1));
      if (this.rows[this.selected]) this.rows[this.selected].classList.remove('selected');
      this.selected = idx;
      const row = this.rows[idx];
      if (row) {
        row.classList.add('selected');
        row.scrollIntoView({ block: 'nearest' });
      }
    }

    _key(e) {
      const k = e.key;
      if (k === 'Escape') {
        this.hide();
      } else if (k === 'ArrowDown') {
        this._setSelected(this.selected + 1);
      } else if (k === 'ArrowUp') {
        this._setSelected(this.selected - 1);
      } else if (k === 'PageDown') {
        this._setSelected(this.selected + 10);
      } else if (k === 'PageUp') {
        this._setSelected(this.selected - 10);
      } else if (k === 'Enter') {
        this.choose();
      } else {
        return;
      }
      e.preventDefault();
    }

    choose() {
      const rel = this.results[this.selected];
      this.hide();
      if (rel) this.onSelect(path.join(this.fs.root, rel));
    }
  }

  TC.CommandPalette = CommandPalette;
})();
