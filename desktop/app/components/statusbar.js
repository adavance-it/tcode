// Bottom status bar — current file, selection range, theme / wrap tags and the
// shortcut hints. Port of App.refreshStatus() in src/app.ts.
'use strict';

(function () {
  const TC = (window.TC = window.TC || {});

  class StatusBar {
    constructor(el) {
      this.el = el;
      this.state = { file: null, selection: null, wrap: false, theme: 'dark' };
    }

    update(patch) {
      Object.assign(this.state, patch);
      this.render();
    }

    render() {
      const s = this.state;
      const esc = TC.escapeHtml;
      const combo = TC.platform.combo;
      let left = s.file ? esc(s.file) : 'No file open';
      if (s.selection) {
        const n = s.selection[1] - s.selection[0] + 1;
        left += ` <span class="sb-tag">${n} line${n === 1 ? '' : 's'} selected · ` +
          `${s.selection[0]}–${s.selection[1]}</span>`;
      }
      const right =
        `<span class="sb-tag">${esc(s.theme)}</span>` +
        `<span class="sb-tag">${s.wrap ? 'wrap' : 'no wrap'}</span>` +
        `${esc(combo('P'))} Search<span class="sb-sep">·</span>` +
        `${esc(combo('A'))} Claude<span class="sb-sep">·</span>` +
        `${esc(combo('G'))} Git`;
      this.el.innerHTML =
        `<span class="sb-left">${left}</span><span class="sb-right">${right}</span>`;
    }
  }

  TC.StatusBar = StatusBar;
})();
