// Minimal markdown → HTML renderer for the Claude chat answer area: headings,
// lists, bold, italic, inline code, fenced code (syntax-highlighted), and file
// refs of the form `path/to/file.ext:LINE` turned into clickable links.
'use strict';

(function () {
  const TC = (window.TC = window.TC || {});
  const hljs = TC.hljs;
  const esc = TC.escapeHtml;

  // A ref token: a file-ish path with an extension, optional :LINE.
  const REF_RE = /^([A-Za-z0-9_./@-]+\.[A-Za-z0-9]+)(?::(\d+))?/;

  function attr(s) {
    return String(s).replace(/[&"<>]/g, (c) =>
      c === '&' ? '&amp;' : c === '"' ? '&quot;' : c === '<' ? '&lt;' : '&gt;');
  }

  // refTest(rel, line?) → { path, rel, line } when the path resolves to a real
  // file under the project root, else null/undefined.
  function refAnchor(text, ref) {
    return (
      `<a class="ref" data-path="${attr(ref.path)}"` +
      (ref.line ? ` data-line="${ref.line}"` : '') +
      `>${esc(text)}</a>`
    );
  }

  // Inline span rendering: **bold**, *italic*, `code`, refs (bare or in
  // backticks). Recurses into bold/italic content.
  function renderInline(s, refTest) {
    let html = '';
    let i = 0;
    while (i < s.length) {
      if (s.startsWith('**', i)) {
        const end = s.indexOf('**', i + 2);
        if (end > i + 2) {
          html += '<strong>' + renderInline(s.slice(i + 2, end), refTest) + '</strong>';
          i = end + 2;
          continue;
        }
      }
      if (s[i] === '`') {
        const end = s.indexOf('`', i + 1);
        if (end > i) {
          const inner = s.slice(i + 1, end);
          const m = inner.match(REF_RE);
          if (m && m[0] === inner) {
            const ref = refTest(m[1], m[2] ? parseInt(m[2], 10) : undefined);
            if (ref) {
              html += refAnchor(inner, ref);
              i = end + 1;
              continue;
            }
          }
          html += '<code>' + esc(inner) + '</code>';
          i = end + 1;
          continue;
        }
      }
      if (s[i] === '*' && s[i + 1] !== '*') {
        const end = s.indexOf('*', i + 1);
        if (end > i + 1 && s[end + 1] !== '*') {
          html += '<em>' + renderInline(s.slice(i + 1, end), refTest) + '</em>';
          i = end + 1;
          continue;
        }
      }
      if (/[A-Za-z0-9_]/.test(s[i])) {
        const m = s.slice(i).match(REF_RE);
        if (m) {
          const ref = refTest(m[1], m[2] ? parseInt(m[2], 10) : undefined);
          if (ref) {
            html += refAnchor(m[0], ref);
            i += m[0].length;
            continue;
          }
        }
      }
      html += esc(s[i]);
      i++;
    }
    return html;
  }

  TC.renderMarkdown = function renderMarkdown(text, refTest) {
    const lines = String(text).split('\n');
    let html = '';
    let inCode = false;
    let codeLang = '';
    let codeBuf = [];
    let listType = null;
    let para = [];

    const flushPara = () => {
      if (para.length) {
        html += '<p>' + para.map((l) => renderInline(l, refTest)).join('<br>') + '</p>';
        para = [];
      }
    };
    const closeList = () => {
      if (listType) {
        html += `</${listType}>`;
        listType = null;
      }
    };
    const flushCode = () => {
      const body = codeBuf.join('\n');
      let inner;
      if (codeLang && hljs.getLanguage(codeLang)) {
        try {
          inner = hljs.highlight(body, { language: codeLang, ignoreIllegals: true }).value;
        } catch {
          inner = esc(body);
        }
      } else {
        inner = esc(body);
      }
      html += '<pre><code class="hljs">' + inner + '</code></pre>';
      codeBuf = [];
    };

    for (const line of lines) {
      if (inCode) {
        if (line.trim() === '```') {
          flushCode();
          inCode = false;
        } else {
          codeBuf.push(line);
        }
        continue;
      }
      const fence = line.match(/^```(\w*)\s*$/);
      if (fence) {
        flushPara();
        closeList();
        inCode = true;
        codeLang = fence[1];
        codeBuf = [];
        continue;
      }
      const heading = line.match(/^(#{1,6})\s+(.+)$/);
      if (heading) {
        flushPara();
        closeList();
        const lvl = Math.min(3, heading[1].length);
        html += `<h${lvl}>` + renderInline(heading[2], refTest) + `</h${lvl}>`;
        continue;
      }
      const li = line.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
      if (li) {
        flushPara();
        const want = /\d/.test(li[2]) ? 'ol' : 'ul';
        if (listType !== want) {
          closeList();
          html += `<${want}>`;
          listType = want;
        }
        html += '<li>' + renderInline(li[3], refTest) + '</li>';
        continue;
      }
      if (line.trim() === '') {
        flushPara();
        closeList();
        continue;
      }
      closeList();
      para.push(line);
    }

    if (inCode) flushCode();
    flushPara();
    closeList();
    return html;
  };
})();
