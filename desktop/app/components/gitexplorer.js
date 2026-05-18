// Cmd/Ctrl+G git explorer.
//
// Left pane: a commit log (with --graph + a synthetic "Uncommitted changes"
// entry). Right pane: the diff. Enter on a commit drills into its file list;
// Enter on a file opens it in the editor.
'use strict';

(function () {
  const { spawnSync } = require('child_process');
  const path = require('path');
  const TC = (window.TC = window.TC || {});

  function truncate(s, n) {
    return s.length <= n ? s.padEnd(n, ' ') : s.slice(0, n - 1) + '…';
  }

  // Colorize a unified-diff / diffstat blob into block <span>s.
  function renderDiff(text) {
    if (!text) return '';
    const esc = TC.escapeHtml;
    return text
      .split('\n')
      .map((line) => {
        let cls = '';
        if (/^(diff |index |--- |\+\+\+ |new file|deleted file|old mode|new mode|similarity|rename |Binary )/.test(line)) {
          cls = 'd-meta';
        } else if (line.startsWith('@@')) {
          cls = 'd-hunk';
        } else if (line.startsWith('+')) {
          cls = 'd-add';
        } else if (line.startsWith('-')) {
          cls = 'd-del';
        } else if (/\|\s+\d+\s+[+-]/.test(line)) {
          // diffstat row — colorize the +/- run.
          const html = esc(line)
            .replace(/\+/g, '<span class="d-stat-add">+</span>')
            .replace(/-/g, '<span class="d-stat-del">-</span>');
          return `<span class="dl">${html}</span>`;
        }
        return `<span class="dl ${cls}">${esc(line) || ' '}</span>`;
      })
      .join('');
  }

  class GitExplorer {
    constructor(modalEl, root) {
      this.modal = modalEl;
      this.root = root;
      this.commits = [];
      this.commitRows = []; // { connector, commitIdx, html }
      this.commitRowMap = [];
      this.files = [];
      this.selectedCommit = null;
      this.mode = 'commits';
      this.selectedRow = 0;
      this.prevSelectedRow = 0;
      this.rows = [];
      this.visible = false;
      this.onShow = () => {};
      this.onHide = () => {};
      this.onOpenFile = () => {};

      this.modal.innerHTML =
        '<div class="modal-head">Git Explorer — Esc to close</div>' +
        '<div class="git-body">' +
        '<div class="git-left">' +
        '<div class="git-subhead" id="git-list-label">Commits</div>' +
        '<div class="git-list" tabindex="0"></div>' +
        '</div>' +
        '<div class="git-right">' +
        '<div class="git-subhead" id="git-diff-label">Diff</div>' +
        '<div class="git-diff" tabindex="0"></div>' +
        '</div>' +
        '</div>' +
        '<div class="git-hint"></div>';

      this.listLabel = this.modal.querySelector('#git-list-label');
      this.diffLabel = this.modal.querySelector('#git-diff-label');
      this.list = this.modal.querySelector('.git-list');
      this.diff = this.modal.querySelector('.git-diff');
      this.hint = this.modal.querySelector('.git-hint');

      this.list.addEventListener('keydown', (e) => this._listKey(e));
      this.diff.addEventListener('keydown', (e) => this._diffKey(e));
      for (const [el, head] of [[this.list, this.listLabel], [this.diff, this.diffLabel]]) {
        el.addEventListener('focus', () => head.classList.add('focused'));
        el.addEventListener('blur', () => head.classList.remove('focused'));
      }
    }

    _git(args, maxBuffer) {
      return spawnSync('git', args, {
        cwd: this.root,
        encoding: 'utf8',
        maxBuffer: maxBuffer || 50 * 1024 * 1024,
      });
    }

    show() {
      this.mode = 'commits';
      this.visible = true;
      this.modal.classList.remove('hidden');
      this.onShow();
      this._loadCommits();
      this.list.focus();
      this._refreshHint();
    }

    hide() {
      if (!this.visible) return;
      this.visible = false;
      this.modal.classList.add('hidden');
      this.onHide();
    }

    // Point the git explorer at a different repository root.
    setRoot(root) {
      this.root = root;
    }

    _loadCommits() {
      this.commits = [];
      this.commitRowMap = [];
      this.commitRows = [];

      // Synthetic working-tree entry when there are uncommitted changes.
      const status = this._git(['status', '--porcelain']);
      if (status.status === 0 && status.stdout.trim()) {
        const n = status.stdout.split('\n').filter((l) => l.trim()).length;
        this.commits.push({
          sha: '', shortSha: '~', date: '', author: '',
          subject: 'Uncommitted changes', working: true,
        });
        this.commitRowMap.push(0);
        this.commitRows.push({
          connector: false,
          commitIdx: 0,
          html: `<span class="g-working">● Uncommitted changes (${n})</span>`,
        });
      }

      const r = this._git([
        'log', '--graph', '--all', '--decorate',
        '--pretty=format:%x00%H%x00%h%x00%ad%x00%an%x00%s%d',
        '--date=short', '-500',
      ]);

      if (r.status !== 0) {
        if (!this.commits.length) {
          this.commitRows = [];
          this.list.innerHTML =
            '<div class="pal-empty">(not a git repository, or git failed)</div>';
          this.diff.innerHTML = renderDiff(r.stderr || '');
          return;
        }
      } else {
        for (const rawLine of r.stdout.split('\n')) {
          const nul = rawLine.indexOf('\x00');
          if (nul === -1) {
            this.commitRows.push({
              connector: true,
              commitIdx: -1,
              html: `<span class="g-graph">${TC.escapeHtml(rawLine) || ' '}</span>`,
            });
            this.commitRowMap.push(-1);
            continue;
          }
          const graph = rawLine.slice(0, nul);
          const [sha, shortSha, date, author, subject] = rawLine.slice(nul + 1).split('\x00');
          this.commits.push({ sha, shortSha, date, author, subject });
          this.commitRowMap.push(this.commits.length - 1);
          const esc = TC.escapeHtml;
          this.commitRows.push({
            connector: false,
            commitIdx: this.commits.length - 1,
            html:
              `<span class="g-graph">${esc(graph)}</span>` +
              `<span class="g-sha">${esc(shortSha)}</span>  ` +
              `<span class="g-date">${esc(date)}</span>  ` +
              `<span class="g-author">${esc(truncate(author, 14))}</span>  ` +
              `<span>${esc(subject)}</span>`,
          });
        }
      }

      this.mode = 'commits';
      this.listLabel.textContent = 'Commits';
      this._renderList();
      const firstRow = this.commitRowMap.findIndex((i) => i >= 0);
      if (firstRow >= 0) {
        this.selectedRow = firstRow;
        this.prevSelectedRow = firstRow;
        this._markSelected();
        this._previewCommitStat();
      } else {
        this.diff.innerHTML = '';
      }
    }

    _renderList() {
      this.list.innerHTML = '';
      this.rows = [];
      const frag = document.createDocumentFragment();
      if (this.mode === 'commits') {
        this.commitRows.forEach((cr, idx) => {
          const row = document.createElement('div');
          row.className = 'git-row' + (cr.connector ? ' connector' : '');
          row.innerHTML = cr.html;
          if (!cr.connector) {
            row.addEventListener('mousedown', (e) => {
              e.preventDefault();
              this.list.focus();
              this.selectedRow = idx;
              this.prevSelectedRow = idx;
              this._markSelected();
              this._openCommit();
            });
          }
          frag.appendChild(row);
          this.rows.push(row);
        });
      } else {
        this.files.forEach((file, idx) => {
          const row = document.createElement('div');
          row.className = 'git-row';
          row.textContent = file;
          row.addEventListener('mousedown', (e) => {
            e.preventDefault();
            this.list.focus();
            this.selectedRow = idx;
            this._markSelected();
            this._loadFileDiff();
          });
          frag.appendChild(row);
          this.rows.push(row);
        });
      }
      this.list.appendChild(frag);
    }

    _markSelected() {
      this.rows.forEach((row, idx) => row.classList.toggle('selected', idx === this.selectedRow));
      const row = this.rows[this.selectedRow];
      if (row) row.scrollIntoView({ block: 'nearest' });
    }

    // In commits mode, hop off a pure-graph connector row to the nearest real
    // commit in the direction the cursor was last moving.
    _skipConnector() {
      if (this.mode !== 'commits') return;
      let row = this.selectedRow;
      if (this.commitRowMap[row] >= 0) {
        this.prevSelectedRow = row;
        return;
      }
      const dir = row >= this.prevSelectedRow ? 1 : -1;
      let r = row + dir;
      while (r >= 0 && r < this.commitRowMap.length && this.commitRowMap[r] < 0) r += dir;
      if (r < 0 || r >= this.commitRowMap.length) {
        r = row - dir;
        while (r >= 0 && r < this.commitRowMap.length && this.commitRowMap[r] < 0) r -= dir;
      }
      if (r >= 0 && r < this.commitRowMap.length && this.commitRowMap[r] >= 0) {
        this.selectedRow = r;
        this.prevSelectedRow = r;
        this._markSelected();
      }
    }

    _currentCommit() {
      const cidx = this.commitRowMap[this.selectedRow];
      return cidx >= 0 ? this.commits[cidx] : undefined;
    }

    _workingFiles() {
      const r = this._git(['status', '--porcelain']);
      if (r.status !== 0) return [];
      const files = [];
      for (const line of r.stdout.split('\n')) {
        if (!line.trim()) continue;
        let p = line.slice(3);
        const arrow = p.indexOf(' -> ');
        if (arrow >= 0) p = p.slice(arrow + 4);
        p = p.replace(/^"(.*)"$/, '$1');
        files.push(p);
      }
      return files.sort();
    }

    _workingFileDiff(file) {
      let r = this._git(['diff', 'HEAD', '--', file]);
      let out = r.status === 0 ? r.stdout : '';
      if (!out.trim()) {
        // Untracked file: diff against /dev/null renders it as fully added.
        r = this._git(['diff', '--no-index', '--', '/dev/null', file]);
        out = r.stdout || '';
      }
      return out;
    }

    _previewCommitStat() {
      if (this.mode !== 'commits') return;
      const c = this._currentCommit();
      if (!c) return;
      if (c.working) {
        const r = this._git(['diff', 'HEAD', '--stat'], 5 * 1024 * 1024);
        let out = r.status === 0 ? r.stdout : r.stderr || '';
        const untracked = (this._git(['ls-files', '--others', '--exclude-standard']).stdout || '')
          .split('\n')
          .filter(Boolean);
        if (untracked.length) {
          out +=
            (out.trim() ? '\n' : '') +
            `Untracked files (${untracked.length}):\n` +
            untracked.map((u) => '  ' + u).join('\n') + '\n';
        }
        this.diff.innerHTML = renderDiff(out.trim() ? out : '(working tree clean)');
        this.diff.scrollTop = 0;
        this.diffLabel.textContent = 'Uncommitted changes';
        return;
      }
      const r = this._git(
        ['show', '--stat', '--format=%s%n%nAuthor: %an%nDate:   %ad%n%n%b', c.sha],
        5 * 1024 * 1024
      );
      const out = r.status === 0 ? r.stdout : r.stderr || `git show failed for ${c.sha}`;
      this.diff.innerHTML = renderDiff(out);
      this.diff.scrollTop = 0;
      this.diffLabel.textContent = `${c.shortSha} — ${truncate(c.subject, 60).trim()}`;
    }

    _openCommit() {
      const c = this._currentCommit();
      if (!c) return;
      this.selectedCommit = c;

      if (c.working) {
        this.files = this._workingFiles();
        if (!this.files.length) {
          this.diff.innerHTML = renderDiff('(working tree clean)');
          return;
        }
        this.listLabel.textContent = `Uncommitted — Files (${this.files.length})`;
      } else {
        const r = this._git(['show', '--name-only', '--pretty=format:', c.sha]);
        if (r.status !== 0) {
          this.diff.innerHTML = renderDiff(r.stderr || `git show failed for ${c.sha}`);
          return;
        }
        this.files = r.stdout.split('\n').map((s) => s.trim()).filter(Boolean).sort();
        if (!this.files.length) {
          this.diff.innerHTML = renderDiff('(no files in this commit)');
          return;
        }
        this.listLabel.textContent = `${c.shortSha} — Files (${this.files.length})`;
      }

      this.mode = 'files';
      this.selectedRow = 0;
      this._renderList();
      this._markSelected();
      this._refreshHint();
      this._loadFileDiff();
      this.list.focus();
    }

    _backToCommits() {
      this.mode = 'commits';
      this.listLabel.textContent = 'Commits';
      this._renderList();
      this._markSelected();
      this._previewCommitStat();
      this._refreshHint();
      this.list.focus();
    }

    _loadFileDiff() {
      if (this.mode !== 'files') return;
      const c = this.selectedCommit;
      if (!c) return;
      const file = this.files[this.selectedRow];
      if (!file) return;
      if (c.working) {
        const out = this._workingFileDiff(file);
        this.diff.innerHTML = renderDiff(out.trim() ? out : '(no diff for this file)');
        this.diff.scrollTop = 0;
        this.diffLabel.textContent = `${file} (uncommitted)`;
        return;
      }
      const r = this._git(['show', '--format=', c.sha, '--', file]);
      const out = r.status === 0 ? r.stdout : r.stderr || `git show failed for ${c.sha} -- ${file}`;
      this.diff.innerHTML = renderDiff(out || '(no diff for this file)');
      this.diff.scrollTop = 0;
      this.diffLabel.textContent = `${file} @ ${c.shortSha}`;
    }

    _openSelectedFile() {
      const c = this.selectedCommit;
      if (!c) return;
      const file = this.files[this.selectedRow];
      if (!file) return;
      const abs = path.resolve(this.root, file);
      this.hide();
      this.onOpenFile(abs);
    }

    // 'o' on a commit: skip the file list, jump straight to the first file.
    _openTouchedFile() {
      const c = this._currentCommit();
      if (!c) return;
      let files;
      if (c.working) {
        files = this._workingFiles();
      } else {
        const r = this._git(['show', '--name-only', '--pretty=format:', c.sha]);
        if (r.status !== 0) return;
        files = r.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
      }
      if (!files.length) return;
      const abs = path.resolve(this.root, files[0]);
      this.hide();
      this.onOpenFile(abs);
    }

    _move(delta) {
      let next = Math.max(0, Math.min(this.selectedRow + delta, this.rows.length - 1));
      this.selectedRow = next;
      this._markSelected();
      if (this.mode === 'commits') {
        this._skipConnector();
        this._previewCommitStat();
      } else {
        this._loadFileDiff();
      }
    }

    _listKey(e) {
      const k = e.key;
      if (k === 'ArrowDown' || k === 'j') this._move(1);
      else if (k === 'ArrowUp' || k === 'k') this._move(-1);
      else if (k === 'PageDown') this._move(12);
      else if (k === 'PageUp') this._move(-12);
      else if (k === 'g') this._move(-1e9);
      else if (k === 'G') this._move(1e9);
      else if (k === 'Tab') this.diff.focus();
      else if (k === 'Enter') {
        if (this.mode === 'commits') this._openCommit();
        else this._openSelectedFile();
      } else if (k === 'o' && this.mode === 'commits') {
        this._openTouchedFile();
      } else if (k === 'Escape') {
        if (this.mode === 'files') this._backToCommits();
        else this.hide();
      } else {
        return;
      }
      e.preventDefault();
    }

    _diffKey(e) {
      const k = e.key;
      if (k === 'Tab') this.list.focus();
      else if (k === 'Escape') {
        if (this.mode === 'files') this._backToCommits();
        else this.hide();
      } else if (k === 'j' || k === 'ArrowDown') this.diff.scrollTop += 24;
      else if (k === 'k' || k === 'ArrowUp') this.diff.scrollTop -= 24;
      else if (k === 'g') this.diff.scrollTop = 0;
      else if (k === 'G') this.diff.scrollTop = this.diff.scrollHeight;
      else if (k === 'PageDown') this.diff.scrollTop += this.diff.clientHeight * 0.9;
      else if (k === 'PageUp') this.diff.scrollTop -= this.diff.clientHeight * 0.9;
      else return;
      e.preventDefault();
    }

    _refreshHint() {
      this.hint.textContent =
        this.mode === 'commits'
          ? 'Tab: switch panes · Enter: open commit files · o: open touched file · Esc: close'
          : 'Tab: switch panes · Enter: open file in editor · Esc: back to commits';
    }
  }

  TC.GitExplorer = GitExplorer;
})();
