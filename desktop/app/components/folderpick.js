// Alt+Enter — a quick-pick of the folders at the highlighted item's level.
// Type a name, pick one, and the app re-roots into it. Only that one level is
// listed (no recursion into the folders below).
'use strict';

(function () {
  const path = require('path');
  const TC = (window.TC = window.TC || {});

  class FolderPick {
    constructor(modalEl) {
      this.modal = modalEl;
      this.folders = [];
      this.results = [];
      this.rows = [];
      this.selected = 0;
      this.visible = false;
      this.onSelect = () => {};
      this.onShow = () => {};
      this.onHide = () => {};

      this.modal.innerHTML =
        '<div class="modal-head" id="fp-head">Go to folder — Esc to cancel</div>' +
        '<div class="pal-input-wrap"><input class="pal-input" type="text" ' +
        'spellcheck="false" placeholder="Type a folder name…" /></div>' +
        '<div class="pal-list"></div>';
      this.head = this.modal.querySelector('#fp-head');
      this.input = this.modal.querySelector('.pal-input');
      this.list = this.modal.querySelector('.pal-list');

      this.input.addEventListener('keydown', (e) => this._key(e));
      this.input.addEventListener('input', () => this.refresh());
    }

    // List the immediate sub-directories of `levelDir` and open the modal.
    show(levelDir) {
      let dirs = [];
      try {
        const fsys = new TC.FileSystem(levelDir);
        dirs = fsys.listDir(levelDir).filter((n) => n.isDirectory);
      } catch {
        dirs = [];
      }
      this.folders = dirs.map((n) => ({ name: n.name, path: n.path }));
      this.visible = true;
      this.onShow();
      this.modal.classList.remove('hidden');
      this.head.textContent =
        `Go to folder in ${path.basename(levelDir) || levelDir} — Esc to cancel`;
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
      const q = this.input.value.trim().toLowerCase();
      this.results = q
        ? this.folders.filter((f) => f.name.toLowerCase().includes(q))
        : this.folders.slice();
      this.selected = 0;
      this._render();
    }

    _render() {
      this.list.innerHTML = '';
      this.rows = [];
      if (!this.results.length) {
        this.list.innerHTML =
          '<div class="pal-empty">' +
          (this.folders.length ? 'No matching folder.' : 'No subfolders here.') +
          '</div>';
        return;
      }
      const frag = document.createDocumentFragment();
      this.results.forEach((f, idx) => {
        const row = document.createElement('div');
        row.className = 'pal-row' + (idx === this.selected ? ' selected' : '');
        const icon = document.createElement('span');
        icon.className = 'pal-dir';
        icon.textContent = '▸ ';
        const name = document.createElement('span');
        name.className = 'pal-base';
        name.textContent = f.name;
        row.append(icon, name);
        row.addEventListener('mousedown', (e) => {
          e.preventDefault();
          this.selected = idx;
          this.choose();
        });
        frag.appendChild(row);
        this.rows.push(row);
      });
      this.list.appendChild(frag);
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
      if (k === 'Escape') this.hide();
      else if (k === 'ArrowDown') this._setSelected(this.selected + 1);
      else if (k === 'ArrowUp') this._setSelected(this.selected - 1);
      else if (k === 'PageDown') this._setSelected(this.selected + 10);
      else if (k === 'PageUp') this._setSelected(this.selected - 10);
      else if (k === 'Enter') this.choose();
      else return;
      e.preventDefault();
    }

    choose() {
      const f = this.results[this.selected];
      this.hide();
      if (f) this.onSelect(f.path);
    }
  }

  TC.FolderPick = FolderPick;
})();
