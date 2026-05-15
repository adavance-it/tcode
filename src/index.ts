#!/usr/bin/env node
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { spawn, spawnSync } from 'child_process';
import { App } from './app';
import { ThemeChoice } from './theme';

// The canonical install one-liner (kept in sync with README / install.sh).
const INSTALL_CMD =
  'curl -fsSL https://raw.githubusercontent.com/adavance-it/tcode/main/install.sh | bash';

// `tcode update`: re-run the install one-liner so tcode reinstalls itself
// from the latest main (clone/pull + build + npm link). Foreground so the
// installer's progress is visible; exits with the installer's status.
function runUpdate(): never {
  process.stdout.write('tcode: updating via the install script…\n\n');
  const r = spawnSync('sh', ['-c', INSTALL_CMD], { stdio: 'inherit' });
  if (r.error) {
    process.stderr.write(`tcode: update failed: ${r.error.message}\n`);
    process.exit(1);
  }
  process.exit(r.status ?? 0);
}

// Best-effort self-update: pull the latest tcode and rebuild in the background
// so the NEXT launch is current. Never blocks or crashes startup.
function selfUpdate(): void {
  try {
    // Compiled entry lives at <repo>/dist/index.js, so the repo is one up.
    const repoRoot = path.resolve(__dirname, '..');
    if (!fs.existsSync(path.join(repoRoot, '.git'))) return;
    const child = spawn(
      'sh',
      ['-c', 'git pull --quiet --ff-only && npm run build --silent'],
      { cwd: repoRoot, detached: true, stdio: 'ignore' }
    );
    child.unref();
  } catch {
    /* ignore — updating is never allowed to break the app */
  }
}

// Resolve the directory tcode should operate on. `tcode` (no arg) uses the
// current working directory; `tcode <path>` uses that path. Both are
// equivalent ways to point tcode at a folder, and Ctrl+P / the file tree are
// always scoped to it.
function resolveStartDir(arg: string | undefined): string {
  if (!arg) return process.cwd();
  let d = arg;
  if (d === '~') d = os.homedir();
  else if (d.startsWith('~/')) d = path.join(os.homedir(), d.slice(2));
  return path.resolve(d);
}

const args = process.argv.slice(2);

if (args[0] === 'update') runUpdate(); // never returns

let dir: string | undefined;
let wrap = true;
let theme: ThemeChoice = 'auto';

for (const a of args) {
  if (a === '--no-wrap') wrap = false;
  else if (a === '--wrap') wrap = true;
  else if (a === '--dark') theme = 'dark';
  else if (a === '--light') theme = 'light';
  else if (a.startsWith('--theme=')) {
    const v = a.slice('--theme='.length);
    if (v === 'dark' || v === 'light' || v === 'auto') theme = v;
  } else if (a === '-h' || a === '--help') {
    process.stdout.write(
      'Usage: tcode [options] [path]\n' +
      '       tcode update          reinstall tcode from the latest main\n' +
      '\n' +
      'Options:\n' +
      '  --no-wrap          long lines truncated instead of wrapped\n' +
      '  --wrap             wrap long lines (default)\n' +
      '  --theme=auto|dark|light    force a theme (default: auto via $COLORFGBG)\n' +
      '  --dark / --light   shorthand for --theme=...\n' +
      '\n' +
      'In-app shortcuts:\n' +
      '  Tab          switch panes\n' +
      '  Ctrl+P       fuzzy file search\n' +
      '  Ctrl+A       toggle Claude side panel\n' +
      '  Ctrl+G       git explorer (commits + diffs)\n' +
      '  Ctrl+N       (in chat) new conversation\n' +
      '  Shift+↑/↓    extend line selection in editor\n' +
      '  Shift+click  extend selection to clicked line\n' +
      '  d            toggle dark / light theme\n' +
      '  Esc          clear selection\n' +
      '  w            toggle line wrap\n' +
      '  drag splitter to resize panes\n' +
      '  q            quit\n'
    );
    process.exit(0);
  } else if (!a.startsWith('-')) {
    dir = a;
  }
}

const root = resolveStartDir(dir);

try {
  if (!fs.statSync(root).isDirectory()) {
    process.stderr.write(`tcode: not a directory: ${root}\n`);
    process.exit(1);
  }
} catch {
  process.stderr.write(`tcode: no such directory: ${root}\n`);
  process.exit(1);
}

selfUpdate();

const app = new App(root, { wrap, theme });
app.run();
