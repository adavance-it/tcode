// Theme management — dark / light, plus swapping the highlight.js stylesheet.
// Ported from src/theme.ts; in the desktop build the colors live in styles.css
// (CSS custom properties) and this module just flips the mode + hljs theme.
'use strict';

(function () {
  const path = require('path');
  const { pathToFileURL } = require('url');

  const TC = (window.TC = window.TC || {});

  // Locate highlight.js's bundled CSS themes. require.resolve('highlight.js')
  // points at .../highlight.js/lib/index.js, so styles/ is two levels up.
  function hljsStylePath(mode) {
    const root = path.join(path.dirname(require.resolve('highlight.js')), '..');
    const file = mode === 'light' ? 'github.css' : 'github-dark.css';
    return path.join(root, 'styles', file);
  }

  TC.theme = {
    mode: 'dark',

    // Apply a theme mode: toggle the #app class and point the hljs <link> at
    // the matching stylesheet.
    apply(mode) {
      this.mode = mode === 'light' ? 'light' : 'dark';
      const app = document.getElementById('app');
      app.classList.toggle('theme-dark', this.mode === 'dark');
      app.classList.toggle('theme-light', this.mode === 'light');
      const link = document.getElementById('hljs-theme');
      if (link) {
        try {
          link.href = pathToFileURL(hljsStylePath(this.mode)).href;
        } catch {
          /* hljs stylesheet is optional polish — never block on it */
        }
      }
      return this.mode;
    },

    toggle() {
      return this.apply(this.mode === 'dark' ? 'light' : 'dark');
    },
  };
})();
