#!/usr/bin/env node
// tcode-desktop — console launcher.
//
// Boots the Electron app (desktop/main.js) with the user's args forwarded.
// Mirrors the terminal `tcode` CLI: `tcode-desktop [path]`, `--wrap`,
// `--theme=`, `--dark`/`--light`, plus `tcode-desktop update`.

'use strict';

const path = require('path');
const { spawn, spawnSync } = require('child_process');

const HELP = `Usage: tcode-desktop [options] [path]
       tcode-desktop update          reinstall tcode from the latest main

Opens the tcode code explorer as a desktop window. Same features as the
terminal \`tcode\`: file tree, syntax-highlighted viewer, Ctrl+P fuzzy search,
Ctrl+A Claude chat, Ctrl+G git explorer.

Options:
  --no-wrap          long lines scroll horizontally instead of wrapping (default)
  --wrap             wrap long lines
  --theme=auto|dark|light    force a theme (default: auto, follows the OS)
  --dark / --light   shorthand for --theme=...
  -h, --help         show this help

In-app shortcuts:
  Tab          switch panes (Explorer / Editor / Claude)
  Ctrl+P       fuzzy file search
  Ctrl+A       toggle Claude side panel
  Ctrl+G       git explorer (commits + files + diff)
  Ctrl+N       (in chat) new conversation
  Shift+↑/↓    extend line selection in editor
  d            toggle dark / light theme
  w            toggle line wrap
  Esc          close modal / clear selection
  Ctrl+Q       quit
`;

// The canonical install one-liner (kept in sync with README / install.sh).
const INSTALL_CMD =
  'curl -fsSL https://raw.githubusercontent.com/adavance-it/tcode/main/install.sh | bash';

const args = process.argv.slice(2);

// `tcode-desktop update`: re-run the install one-liner (clone/pull + build +
// link). Foreground so the installer's progress is visible.
if (args[0] === 'update') {
  process.stdout.write('tcode-desktop: updating via the install script…\n\n');
  const r = spawnSync('sh', ['-c', INSTALL_CMD], { stdio: 'inherit' });
  process.exit(r.status ?? (r.error ? 1 : 0));
}

if (args.includes('-h') || args.includes('--help')) {
  process.stdout.write(HELP);
  process.exit(0);
}

// `require('electron')` from a plain Node process resolves to the path of the
// bundled Electron executable.
const electronPath = require('electron');
const mainEntry = path.join(__dirname, 'main.js');

// Electron refuses to run as root without --no-sandbox (crbug.com/638180);
// pass it through when we detect a root launch so server / container use works.
const electronArgs = [mainEntry];
if (typeof process.getuid === 'function' && process.getuid() === 0) {
  electronArgs.push('--no-sandbox');
}
electronArgs.push(...args);

const child = spawn(electronPath, electronArgs, {
  stdio: 'inherit',
  windowsHide: false,
});
child.on('close', (code) => process.exit(code == null ? 0 : code));
child.on('error', (err) => {
  process.stderr.write(`tcode-desktop: failed to launch Electron: ${err.message}\n`);
  process.exit(1);
});
