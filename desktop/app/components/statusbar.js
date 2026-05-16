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
      let left = s.file ? esc(s.file) : 'tcode';
      if (s.selection) {
        left += ` <span class="sb-tag">sel ${s.selection[0]}–${s.selection[1]}</span>`;
      }
      const right =
        `<span class="sb-tag">${s.theme}</span>` +
        `<span class="sb-tag">${s.wrap ? 'wrap' : 'no-wrap'}</span>` +
        'Tab<span class="sb-sep">·</span>' +
        '^P search<span class="sb-sep">·</span>' +
        '^A claude<span class="sb-sep">·</span>' +
        '^G git<span class="sb-sep">·</span>' +
        'w wrap<span class="sb-sep">·</span>' +
        'd theme<span class="sb-sep">·</span>' +
        '^Q quit';
      this.el.innerHTML =
        `<span class="sb-left">${left}</span><span class="sb-right">${right}</span>`;
    }
  }

  TC.StatusBar = StatusBar;
})();
