import * as fs from 'fs';
import * as path from 'path';
import ignore, { Ignore } from 'ignore';

export interface TreeNode {
  path: string;
  name: string;
  isDirectory: boolean;
}

const DEFAULT_IGNORE = [
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.turbo',
  'coverage',
  '.cache',
  '.DS_Store',
  '*.log',
  '.idea',
  '.vscode',
];

export class FileSystem {
  root: string;
  ig: Ignore;

  constructor(root: string) {
    this.root = path.resolve(root);
    this.ig = ignore().add(DEFAULT_IGNORE);
    try {
      const gi = fs.readFileSync(path.join(this.root, '.gitignore'), 'utf8');
      this.ig.add(gi);
    } catch {
      /* no gitignore */
    }
  }

  private isIgnored(absPath: string, isDir: boolean): boolean {
    const rel = path.relative(this.root, absPath);
    if (!rel || rel.startsWith('..')) return false;
    const candidate = isDir ? rel + '/' : rel;
    return this.ig.ignores(candidate);
  }

  listDir(dirPath: string): TreeNode[] {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return [];
    }
    const nodes: TreeNode[] = [];
    for (const e of entries) {
      const full = path.join(dirPath, e.name);
      const isDir = e.isDirectory();
      if (this.isIgnored(full, isDir)) continue;
      nodes.push({ path: full, name: e.name, isDirectory: isDir });
    }
    nodes.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return nodes;
  }

  walkAllFiles(limit = 20000): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
      if (out.length >= limit) return;
      const nodes = this.listDir(dir);
      for (const n of nodes) {
        if (out.length >= limit) return;
        if (n.isDirectory) walk(n.path);
        else out.push(n.path);
      }
    };
    walk(this.root);
    return out;
  }
}
