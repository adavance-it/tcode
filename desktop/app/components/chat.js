// Ctrl+A Claude side panel. Port of src/claude.ts.
//
// Runs `claude -p <prompt>` in the project directory, streams the answer,
// renders it as markdown, and turns `path/to/file.ext:LINE` refs into
// clickable links (both inline and in the Refs list) that jump the editor.
'use strict';

(function () {
  const fs = require('fs');
  const path = require('path');
  const { spawn } = require('child_process');
  const TC = (window.TC = window.TC || {});

  const PROMPT_PREAMBLE =
    'You are helping a user explore a codebase from inside a code viewer.\n' +
    'Your answer is rendered with a small markdown subset: headings, lists,\n' +
    '**bold**, *italic*, `inline code`, and fenced code blocks (```lang ...\n' +
    '```) with syntax highlighting. Refs of the form `path/to/file.ext:LINE`\n' +
    "are turned into clickable links that jump the user's editor pane to that\n" +
    'exact line.\n\n' +
    'HARD REQUIREMENTS for your answer:\n' +
    '- Concise (under 250 words).\n' +
    '- WHENEVER you mention any specific code construct — function, method,\n' +
    '  class, type, constant, endpoint, route, command, schema field, env\n' +
    '  var, config key, file, etc. — you MUST hyperlink it as\n' +
    '  `path/to/file.ext:LINE`. The path MUST be relative to the user\'s\n' +
    '  current working directory. The line number MUST point at the\n' +
    "  construct's definition (or, if you're describing a usage, the most\n" +
    '  relevant call site).\n' +
    '- Link every construct individually. Do not aggregate ("see foo.ts");\n' +
    '  give exact `file:LINE` for each one.\n' +
    '- Verify the line numbers against the actual file before answering.\n' +
    "  If you're not sure of an exact line, grep / read the file first.\n" +
    '- Use fenced code blocks for any quoted code so it gets highlighted.\n\n';

  class ClaudeChat {
    constructor(paneEl, root) {
      this.pane = paneEl;
      this.root = root;
      this.child = null;
      this.refs = [];
      this.refRows = [];
      this.selectedRef = 0;
      this.streamingText = '';
      this.lastAnswer = '';
      this.hasConversation = false;
      this.pendingContext = null;
      this.visible = false;

      this.onOpenFile = () => {};
      this.onShow = () => {};
      this.onHide = () => {};
      this.onDefocus = () => {};

      this.pane.innerHTML =
        '<div class="chat-wrap">' +
        '<div class="chat-q-label">Question</div>' +
        '<input class="chat-input" type="text" spellcheck="false" ' +
        'placeholder="Ask Claude about this codebase…" />' +
        '<div class="chat-context"></div>' +
        '<div class="chat-a-label">Answer</div>' +
        '<div class="chat-answer" tabindex="0"></div>' +
        '<div class="chat-r-label">References</div>' +
        '<div class="chat-refs" tabindex="0"></div>' +
        '<div class="chat-hint">Ctrl+N new · Tab cycle · Ctrl+A close · Esc → editor</div>' +
        '</div>';

      this.input = this.pane.querySelector('.chat-input');
      this.context = this.pane.querySelector('.chat-context');
      this.answer = this.pane.querySelector('.chat-answer');
      this.refsList = this.pane.querySelector('.chat-refs');

      this.answer.innerHTML = '<div class="chat-status">(Type a question above and press Enter)</div>';

      this._wireKeys();

      // Click a styled ref inside the rendered answer → open it.
      this.answer.addEventListener('mousedown', (e) => {
        const a = e.target.closest && e.target.closest('a.ref');
        if (!a) return;
        e.preventDefault();
        const line = a.dataset.line ? parseInt(a.dataset.line, 10) : undefined;
        this.onOpenFile(a.dataset.path, line);
      });

      // Track focus so the renderer / CSS can show the active sub-widget.
      for (const el of [this.answer, this.refsList]) {
        el.addEventListener('focus', () => el.classList.add('focused'));
        el.addEventListener('blur', () => el.classList.remove('focused'));
      }
    }

    _wireKeys() {
      this.input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); this.ask(); }
        else if (e.ctrlKey && e.key === 'n') { e.preventDefault(); this.newConversation(); }
        else if (e.key === 'Tab') { e.preventDefault(); this.answer.focus(); }
        else if (e.key === 'Escape') { e.preventDefault(); this.onDefocus(); }
      });
      this.answer.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 'n') { e.preventDefault(); this.newConversation(); }
        else if (e.key === 'Tab') { e.preventDefault(); this.refsList.focus(); }
        else if (e.key === 'Escape') { e.preventDefault(); this.onDefocus(); }
      });
      this.refsList.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 'n') { e.preventDefault(); this.newConversation(); }
        else if (e.key === 'Tab') { e.preventDefault(); this.focusInput(); }
        else if (e.key === 'Escape') { e.preventDefault(); this.onDefocus(); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); this._selectRef(this.selectedRef + 1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); this._selectRef(this.selectedRef - 1); }
        else if (e.key === 'Enter') { e.preventDefault(); this._openSelectedRef(); }
      });
    }

    show(opts) {
      opts = opts || {};
      this.visible = true;
      this.pane.classList.remove('hidden');
      this.input.value = '';
      if (opts.context) {
        this.pendingContext = opts.context;
        const rel = path.relative(this.root, opts.context.file);
        const n = opts.context.range[1] - opts.context.range[0] + 1;
        this.context.textContent =
          `Context: ${rel}:${opts.context.range[0]}-${opts.context.range[1]} ` +
          `(${n} line${n === 1 ? '' : 's'}) — sent with your question`;
      } else {
        this.pendingContext = null;
        this.context.textContent = '';
      }
      if (!this.hasConversation) {
        this.answer.innerHTML =
          '<div class="chat-status">(Type a question above and press Enter)</div>';
        this._renderRefs();
      }
      this.onShow();
      this.focusInput();
    }

    hide() {
      if (!this.visible) return;
      this.visible = false;
      if (this.child && !this.child.killed) {
        try { this.child.kill('SIGTERM'); } catch { /* ignore */ }
      }
      this.pane.classList.add('hidden');
      this.onHide();
    }

    focusInput() {
      this.input.focus();
      this.input.select();
    }

    newConversation() {
      this.hasConversation = false;
      this.lastAnswer = '';
      this.streamingText = '';
      this.refs = [];
      this.pendingContext = null;
      this.input.value = '';
      this.context.textContent = '';
      this.answer.innerHTML =
        '<div class="chat-status">(Type a question above and press Enter)</div>';
      this._renderRefs();
      this.focusInput();
    }

    ask() {
      const q = this.input.value.trim();
      if (!q) return;

      this.refs = [];
      this.streamingText = '';
      this.answer.innerHTML = '<div class="chat-status">Asking Claude…</div>';
      this._renderRefs();

      let prompt = PROMPT_PREAMBLE;
      if (this.pendingContext) {
        const rel = path.relative(this.root, this.pendingContext.file);
        prompt +=
          `The user has selected the following lines from \`${rel}\` ` +
          `(lines ${this.pendingContext.range[0]}-${this.pendingContext.range[1]}):\n\n` +
          '```\n' + this.pendingContext.text + '\n```\n\n';
      }
      prompt += `Question: ${q}`;

      let stderr = '';
      try {
        this.child = spawn('claude', ['-p', prompt], {
          cwd: this.root,
          env: process.env,
        });
      } catch (e) {
        this.answer.innerHTML =
          `<div class="chat-error">Failed to spawn claude: ${TC.escapeHtml(e.message)}</div>`;
        return;
      }

      this.child.stdout.on('data', (d) => {
        this.streamingText += d.toString();
        this._updateAnswer();
      });
      this.child.stderr.on('data', (d) => { stderr += d.toString(); });
      this.child.on('error', (err) => {
        this.answer.innerHTML =
          `<div class="chat-error">Error running 'claude': ${TC.escapeHtml(err.message)}\n\n` +
          `Make sure the Claude Code CLI is installed and on your PATH.</div>`;
      });
      this.child.on('close', (code) => {
        this.child = null;
        if (code !== 0 && code !== null && !this.streamingText) {
          this.answer.innerHTML =
            `<div class="chat-error">claude exited with code ${code}\n\n` +
            `${TC.escapeHtml(stderr)}</div>`;
          return;
        }
        this.lastAnswer = this.streamingText;
        this.hasConversation = true;
        this._updateAnswer();
        if (this.refs.length) this._selectRef(0, false);
      });
    }

    _updateAnswer() {
      this.refs = this._parseRefs(this.streamingText);
      const html = TC.renderMarkdown(this.streamingText, (rel, line) =>
        this._findRefMatch(rel, line)
      );
      this.answer.innerHTML = '<div class="md">' + html + '</div>';
      this.answer.scrollTop = this.answer.scrollHeight;
      this._renderRefs();
    }

    _renderRefs() {
      this.refsList.innerHTML = '';
      this.refRows = [];
      if (!this.refs.length) {
        this.refsList.innerHTML =
          '<div class="chat-ref-empty">' +
          (this.streamingText ? '(no file references found in answer)' : '(no references yet)') +
          '</div>';
        return;
      }
      const frag = document.createDocumentFragment();
      this.refs.forEach((r, idx) => {
        const row = document.createElement('div');
        row.className = 'chat-ref-row' + (idx === this.selectedRef ? ' selected' : '');
        const name = document.createElement('span');
        name.textContent = r.rel;
        row.appendChild(name);
        if (r.line) {
          const ln = document.createElement('span');
          ln.className = 'cr-line';
          ln.textContent = ':' + r.line;
          row.appendChild(ln);
        }
        row.addEventListener('mousedown', (e) => {
          e.preventDefault();
          this.selectedRef = idx;
          this.onOpenFile(r.path, r.line);
        });
        frag.appendChild(row);
        this.refRows.push(row);
      });
      this.refsList.appendChild(frag);
    }

    _selectRef(idx, open) {
      if (!this.refs.length) return;
      idx = Math.max(0, Math.min(idx, this.refs.length - 1));
      if (this.refRows[this.selectedRef]) this.refRows[this.selectedRef].classList.remove('selected');
      this.selectedRef = idx;
      const row = this.refRows[idx];
      if (row) {
        row.classList.add('selected');
        row.scrollIntoView({ block: 'nearest' });
      }
      if (open !== false) this._openSelectedRef();
    }

    _openSelectedRef() {
      const r = this.refs[this.selectedRef];
      if (r) this.onOpenFile(r.path, r.line);
    }

    _findRefMatch(rel, line) {
      return (
        this.refs.find((r) => r.rel === rel && (line == null || r.line === line)) ||
        this.refs.find((r) => r.rel === rel)
      );
    }

    // Scan an answer for file refs (path with extension, optional :LINE) that
    // resolve to real files under the project root.
    _parseRefs(text) {
      const seen = new Set();
      const refs = [];
      const regex = /[`"'(\[]?([A-Za-z0-9_./@-]+\.[A-Za-z0-9]+)(?::(\d+))?[`"')\]]?/g;
      let m;
      while ((m = regex.exec(text))) {
        const rel = m[1];
        const line = m[2] ? parseInt(m[2], 10) : undefined;
        if (!rel || rel.startsWith('http') || rel.startsWith('//')) continue;
        if (rel.length > 256) continue;
        const abs = path.isAbsolute(rel) ? rel : path.resolve(this.root, rel);
        if (!abs.startsWith(this.root + path.sep) && abs !== this.root) continue;
        const key = abs + (line ? ':' + line : '');
        if (seen.has(key)) continue;
        try {
          if (!fs.statSync(abs).isFile()) continue;
        } catch {
          continue;
        }
        seen.add(key);
        refs.push({ path: abs, rel: path.relative(this.root, abs), line });
      }
      return refs;
    }
  }

  TC.ClaudeChat = ClaudeChat;
})();
