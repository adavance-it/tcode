// Cmd/Ctrl+Shift+C — clone a GitHub repository into the current project root.
'use strict';

(function () {
  const path = require('path');
  const { spawn } = require('child_process');
  const TC = (window.TC = window.TC || {});

  // Build a clone URL from "owner/repo", a full https/ssh/git URL, or return
  // null when the input doesn't look like either.
  function repoUrl(input) {
    input = input.trim();
    if (!input) return null;
    if (/^(https?:\/\/|git@|ssh:\/\/)/.test(input)) return input;
    const m = input.match(/^([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
    if (m) return `https://github.com/${m[1]}/${m[2]}.git`;
    return null;
  }

  // The directory name `git clone <url>` will create.
  function repoDirName(url) {
    let name = url.replace(/\.git$/, '').replace(/[/]+$/, '');
    name = name.slice(name.lastIndexOf('/') + 1);
    return name.slice(name.lastIndexOf(':') + 1) || 'repo';
  }

  class CloneModal {
    constructor(modalEl) {
      this.modal = modalEl;
      this.dest = null;
      this.child = null;
      this.visible = false;
      this.onShow = () => {};
      this.onHide = () => {};
      this.onCloned = () => {};

      this.modal.innerHTML =
        '<div class="modal-head">Clone a repository — Esc to cancel</div>' +
        '<div class="clone-body">' +
        '<label class="clone-label">GitHub repo (owner/repo) or a full git URL</label>' +
        '<input class="clone-input" type="text" spellcheck="false" ' +
        'placeholder="adavance-it/tcode" />' +
        '<div class="clone-status"></div>' +
        '<div class="clone-hint">Enter to clone · Esc to cancel</div>' +
        '</div>';

      this.input = this.modal.querySelector('.clone-input');
      this.status = this.modal.querySelector('.clone-status');

      this.input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          this.hide();
        } else if (e.key === 'Enter') {
          e.preventDefault();
          this._clone();
        }
      });
    }

    show(destDir) {
      this.dest = destDir;
      this.visible = true;
      this.onShow();
      this.modal.classList.remove('hidden');
      this.input.value = '';
      this.input.disabled = false;
      this._setStatus('Will clone into ' + destDir, false);
      this.input.focus();
    }

    hide() {
      if (!this.visible) return;
      this.visible = false;
      // A clone already in progress is left to finish in the background.
      this.modal.classList.add('hidden');
      this.onHide();
    }

    _setStatus(text, isError) {
      this.status.textContent = text;
      this.status.className = 'clone-status' + (isError ? ' err' : '');
    }

    _clone() {
      const url = repoUrl(this.input.value);
      if (!url) {
        this._setStatus('Enter "owner/repo" or a full git URL.', true);
        return;
      }
      const name = repoDirName(url);
      this._setStatus(`Cloning ${name}…`, false);
      this.input.disabled = true;

      let stderr = '';
      let child;
      try {
        child = spawn('git', ['clone', '--progress', url], { cwd: this.dest });
      } catch (e) {
        this._setStatus('git not available: ' + e.message, true);
        this.input.disabled = false;
        return;
      }
      this.child = child;
      const lastLine = () => stderr.trim().split('\n').pop();

      child.stderr.on('data', (d) => {
        stderr += d.toString();
        // git clone reports progress on stderr — surface the latest line.
        const line = lastLine();
        if (line) this._setStatus(line, false);
      });
      child.on('error', (err) => {
        this.child = null;
        this._setStatus('git not available: ' + err.message, true);
        this.input.disabled = false;
      });
      child.on('close', (code) => {
        this.child = null;
        if (code === 0) {
          const cloned = path.join(this.dest, name);
          this.hide();
          this.onCloned(cloned);
        } else {
          this._setStatus(lastLine() || `git clone failed (exit ${code})`, true);
          this.input.disabled = false;
        }
      });
    }
  }

  TC.CloneModal = CloneModal;
})();
