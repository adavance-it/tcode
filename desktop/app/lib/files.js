// Gitignore-aware filesystem walker.
'use strict';

(function () {
  const fs = require('fs');
  const path = require('path');
  const ignore = require('ignore');

  const TC = (window.TC = window.TC || {});

  const DEFAULT_IGNORE = [
    'node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt',
    '.turbo', 'coverage', '.cache', '.DS_Store', '*.log', '.idea', '.vscode',
  ];

  class FileSystem {
    constructor(root) {
      this.root = path.resolve(root);
      this.ig = ignore().add(DEFAULT_IGNORE);
      try {
        this.ig.add(fs.readFileSync(path.join(this.root, '.gitignore'), 'utf8'));
      } catch {
        /* no .gitignore — defaults still apply */
      }
    }

    isIgnored(absPath, isDir) {
      const rel = path.relative(this.root, absPath);
      if (!rel || rel.startsWith('..')) return false;
      const candidate = isDir ? rel + '/' : rel;
      return this.ig.ignores(candidate);
    }

    // List one directory: { path, name, isDirectory }, dirs first then files,
    // each set sorted by name. Ignored entries are dropped.
    listDir(dirPath) {
      let entries;
      try {
        entries = fs.readdirSync(dirPath, { withFileTypes: true });
      } catch {
        return [];
      }
      const nodes = [];
      for (const e of entries) {
        const full = path.join(dirPath, e.name);
        let isDir = e.isDirectory();
        // Resolve symlinks so linked directories still expand.
        if (e.isSymbolicLink()) {
          try { isDir = fs.statSync(full).isDirectory(); } catch { continue; }
        }
        if (this.isIgnored(full, isDir)) continue;
        nodes.push({ path: full, name: e.name, isDirectory: isDir });
      }
      nodes.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      return nodes;
    }

    // Flat list of every non-ignored file under root (capped), for Ctrl+P.
    walkAllFiles(limit = 20000) {
      const out = [];
      const walk = (dir) => {
        if (out.length >= limit) return;
        for (const n of this.listDir(dir)) {
          if (out.length >= limit) return;
          if (n.isDirectory) walk(n.path);
          else out.push(n.path);
        }
      };
      walk(this.root);
      return out;
    }
  }

  TC.FileSystem = FileSystem;
})();
