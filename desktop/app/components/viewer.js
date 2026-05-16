// Editor pane — read-only, syntax-highlighted file viewer with a line-number
// gutter and a line-range selection. Port of src/viewer.ts.
//
// Selection: click / drag on the line-number gutter selects whole lines (the
// range Ctrl+A sends to Claude as context); Shift+↑/↓ extends it from the
// keyboard. The code column keeps native text selection for copy/paste.
'use strict';

(function () {
  const fs = require('fs');
  const path = require('path');
  const TC = (window.TC = window.TC || {});

  const MAX_FILE_BYTES = 2 * 1024 * 1024;

  function isLikelyBinary(buf) {
    const len = Math.min(buf.length, 1024);
    for (let i = 0; i < len; i++) if (buf[i] === 0) return true;
    return false;
  }

  const WELCOME = `<div class="welcome"><h1>tcode — read-only code explorer</h1>` +
    `Pick a file in the Explorer (Enter) to view its content.\n\n` +
    `Shortcuts:\n` +
    `  <span class="key">Tab</span>            switch Explorer / Editor / Claude\n` +
    `  <span class="key">Enter</span>          open file / toggle directory\n` +
    `  <span class="key">Ctrl+P</span>         fuzzy file search\n` +
    `  <span class="key">Ctrl+A</span>         toggle Claude side panel\n` +
    `  <span class="key">Ctrl+G</span>         git explorer (commits + files + diff)\n` +
    `  <span class="key">j / k  ↑ / ↓</span>   scroll\n` +
    `  <span class="key">g / G</span>          top / bottom of file\n` +
    `  <span class="key">Shift+↑/↓</span>      extend line selection\n` +
    `  <span class="key">click gutter</span>   select a line (drag for a range)\n` +
    `  <span class="key">w</span>              toggle line wrap\n` +
    `  <span class="key">d</span>              toggle dark / light theme\n` +
    `  <span class="key">Ctrl+Q</span>         quit</div>`;

  class Viewer {
    constructor(bodyEl, paneEl, opts) {
      opts = opts || {};
      this.body = bodyEl;
      this.pane = paneEl;
      this.label = document.getElementById('viewer-label');
      this.currentFile = null;
      this.rawLines = [];
      this.lineEls = [];
      this.selAnchor = null; // 1-based
      this.selActive = null; // 1-based
      this.hlLine = null;
      this.dragging = false;

      this.onFileChange = () => {};
      this.onSelectionChange = () => {};
      this.onWrapChange = () => {};

      this.body.innerHTML = WELCOME;
      this.pane.addEventListener('keydown', (e) => this.handleKey(e));

      // Line-range selection from the gutter.
      this.body.addEventListener('mousedown', (e) => {
        const ln = this._lineFromEvent(e, true);
        if (ln == null) return;
        e.preventDefault();
        this.pane.focus();
        if (e.shiftKey && this.selAnchor != null) {
          this.selActive = ln;
        } else {
          this.selAnchor = ln;
          this.selActive = ln;
        }
        this.dragging = true;
        this._applySelection();
        this.onSelectionChange();
      });
      document.addEventListener('mousemove', (e) => {
        if (!this.dragging) return;
        const ln = this._lineFromEvent(e, false);
        if (ln == null || ln === this.selActive) return;
        this.selActive = ln;
        this._applySelection();
        this.onSelectionChange();
      });
      document.addEventListener('mouseup', () => {
        this.dragging = false;
      });

      this.setWrap(!!opts.wrap, true);
    }

    // Map a mouse event to a 1-based line number. `gutterOnly` requires the
    // pointer to be over the line-number column (a selection gesture).
    _lineFromEvent(e, gutterOnly) {
      let el = e.target;
      if (gutterOnly) {
        if (!el || !el.classList || !el.classList.contains('lnum')) return null;
      }
      const vline = el && el.closest ? el.closest('.vline') : null;
      if (!vline) {
        // During a drag the pointer can be between rows — resolve by point.
        const hit = document.elementFromPoint(e.clientX, e.clientY);
        const vl = hit && hit.closest ? hit.closest('.vline') : null;
        if (!vl) return null;
        return parseInt(vl.dataset.ln, 10);
      }
      return parseInt(vline.dataset.ln, 10);
    }

    load(filePath, line) {
      this.hlLine = line && line > 0 ? line : null;
      this.selAnchor = null;
      this.selActive = null;
      this.dragging = false;

      let raw = '';
      let message = null;
      try {
        const stat = fs.statSync(filePath);
        if (!stat.isFile()) {
          message = 'Not a regular file.';
        } else if (stat.size > MAX_FILE_BYTES) {
          message = `File too large to display (${(stat.size / 1024).toFixed(0)} KB).`;
        } else {
          const buf = fs.readFileSync(filePath);
          if (isLikelyBinary(buf)) {
            message = `Binary file (${stat.size} bytes) — preview disabled.`;
          } else {
            raw = buf.toString('utf8');
          }
        }
      } catch (e) {
        message = `Error reading file: ${e.message}`;
      }

      this.currentFile = filePath;
      if (this.label) this.label.textContent = path.basename(filePath);

      if (message != null) {
        this.rawLines = [];
        this.lineEls = [];
        this.body.innerHTML = `<div class="viewer-msg">${TC.escapeHtml(message)}</div>`;
        this.onFileChange(filePath);
        return;
      }

      this.rawLines = raw.split('\n');
      const lang = TC.detectLanguage(filePath);
      const htmlLines = TC.highlightLines(raw, lang);
      const digits = String(this.rawLines.length).length;
      this.body.style.setProperty('--lnw', String(digits));

      let html = '<div class="code-doc">';
      for (let i = 0; i < htmlLines.length; i++) {
        html +=
          `<div class="vline" data-ln="${i + 1}">` +
          `<span class="lnum">${i + 1}</span>` +
          `<span class="vcode">${htmlLines[i] || ' '}</span>` +
          `</div>`;
      }
      html += '</div>';
      this.body.innerHTML = html;
      this.lineEls = Array.from(this.body.querySelectorAll('.vline'));

      this.body.scrollTop = 0;
      if (this.hlLine) {
        const el = this.lineEls[this.hlLine - 1];
        if (el) {
          el.classList.add('hl');
          this.scrollToLine(this.hlLine);
        }
      }
      this.onFileChange(filePath);
    }

    _applySelection() {
      const range = this.selectionRange();
      for (let i = 0; i < this.lineEls.length; i++) {
        const inSel = range && i + 1 >= range[0] && i + 1 <= range[1];
        this.lineEls[i].classList.toggle('selected', !!inSel);
      }
    }

    selectionRange() {
      if (this.selAnchor == null || this.selActive == null) return null;
      return [
        Math.min(this.selAnchor, this.selActive),
        Math.max(this.selAnchor, this.selActive),
      ];
    }

    selectionText() {
      const r = this.selectionRange();
      if (!r) return '';
      return this.rawLines.slice(r[0] - 1, r[1]).join('\n');
    }

    clearSelection() {
      if (this.selAnchor == null && this.selActive == null) return;
      this.selAnchor = null;
      this.selActive = null;
      this._applySelection();
      this.onSelectionChange();
    }

    extendSelection(delta) {
      if (!this.rawLines.length) return;
      if (this.selAnchor == null) {
        const start = this._firstVisibleLine();
        this.selAnchor = start;
        this.selActive = start;
      }
      const max = this.rawLines.length;
      this.selActive = Math.max(1, Math.min(max, (this.selActive || 1) + delta));
      this._applySelection();
      const el = this.lineEls[this.selActive - 1];
      if (el) el.scrollIntoView({ block: 'nearest' });
      this.onSelectionChange();
    }

    _firstVisibleLine() {
      const top = this.body.scrollTop;
      for (let i = 0; i < this.lineEls.length; i++) {
        if (this.lineEls[i].offsetTop >= top) return i + 1;
      }
      return 1;
    }

    _lineHeight() {
      if (this.lineEls.length) return this.lineEls[0].offsetHeight || 20;
      return 20;
    }

    scrollToLine(line) {
      const el = this.lineEls[line - 1];
      if (!el) return;
      this.body.scrollTop = Math.max(0, el.offsetTop - this.body.clientHeight / 3);
    }

    setWrap(on, silent) {
      this.wrap = !!on;
      document.getElementById('app').classList.toggle('wrap-on', this.wrap);
      document.getElementById('app').classList.toggle('wrap-off', !this.wrap);
      if (!silent) this.onWrapChange(this.wrap);
    }

    toggleWrap() {
      this.setWrap(!this.wrap);
    }

    handleKey(e) {
      const k = e.key;
      const lh = this._lineHeight();
      const half = Math.max(1, Math.floor(this.body.clientHeight / lh / 2));
      if ((k === 'ArrowDown' && e.shiftKey) || k === 'J') {
        this.extendSelection(1);
      } else if ((k === 'ArrowUp' && e.shiftKey) || k === 'K') {
        this.extendSelection(-1);
      } else if (k === 'ArrowDown' || k === 'j') {
        this.body.scrollTop += lh;
      } else if (k === 'ArrowUp' || k === 'k') {
        this.body.scrollTop -= lh;
      } else if (k === 'g') {
        this.body.scrollTop = 0;
      } else if (k === 'G') {
        this.body.scrollTop = this.body.scrollHeight;
      } else if (k === 'PageDown' || (e.ctrlKey && k === 'd')) {
        this.body.scrollTop += half * lh;
      } else if (k === 'PageUp' || (e.ctrlKey && k === 'u')) {
        this.body.scrollTop -= half * lh;
      } else if (k === 'Escape') {
        this.clearSelection();
      } else {
        return;
      }
      e.preventDefault();
    }

    focus() {
      this.pane.focus();
    }
  }

  TC.Viewer = Viewer;
})();
