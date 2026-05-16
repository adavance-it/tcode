// Syntax highlighting via highlight.js, sliced into one HTML string per source
// line so the viewer can render a line-number gutter and per-line backgrounds.
'use strict';

(function () {
  const hljs = require('highlight.js');
  const TC = (window.TC = window.TC || {});

  function escapeHtml(s) {
    return s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
  }

  // Highlight `code` and return an array of HTML strings, one per source line.
  // highlight.js can open a <span> on one line and close it several lines
  // later; rendering line-by-line would leave that markup unbalanced, so any
  // span still open at a line's end is closed and re-opened on the next line.
  function highlightLines(code, lang) {
    let html;
    if (lang && hljs.getLanguage(lang)) {
      try {
        html = hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
      } catch {
        html = escapeHtml(code);
      }
    } else {
      html = escapeHtml(code);
    }

    const out = [];
    let openTags = [];
    for (const line of html.split('\n')) {
      const stack = openTags.slice();
      const tagRe = /<span\b[^>]*>|<\/span>/g;
      let m;
      while ((m = tagRe.exec(line))) {
        if (m[0][1] === '/') stack.pop();
        else stack.push(m[0]);
      }
      out.push(openTags.join('') + line + '</span>'.repeat(stack.length));
      openTags = stack;
    }
    return out;
  }

  TC.highlightLines = highlightLines;
  TC.escapeHtml = escapeHtml;
  TC.hljs = hljs;
})();
