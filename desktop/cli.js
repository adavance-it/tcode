#!/usr/bin/env node
// tcode — console launcher.
//
// Boots the Electron app (desktop/main.js) with the user's args forwarded,
// detached from the terminal. CLI: `tcode [path]`, `--wrap`, `--theme=`,
// `--dark`/`--light`, plus `tcode update`.

'use strict';

const path = require('path');
const { spawn, spawnSync } = require('child_process');

// In-app shortcuts use the OS-primary modifier: Cmd on macOS, Ctrl elsewhere.
const isMac = process.platform === 'darwin';
const K = isMac ? (k) => '⌘' + k : (k) => 'Ctrl+' + k;
const KS = isMac ? (k) => '⌘⇧' + k : (k) => 'Ctrl+Shift+' + k;
const KA = isMac ? (k) => '⌥' + k : (k) => 'Alt+' + k;

const HELP = `Usage: tcode [options] [path]
       tcode update          reinstall tcode from the latest main

Opens the tcode code explorer in a desktop window: a read-only file tree, a
syntax-highlighted viewer, ${K('P')} fuzzy search, ${K('A')} Claude chat and a
${K('G')} git explorer.

Options:
  --no-wrap          long lines scroll horizontally instead of wrapping (default)
  --wrap             wrap long lines
  --theme=auto|dark|light    force a theme (default: auto, follows the OS)
  --dark / --light   shorthand for --theme=...
  -h, --help         show this help

In-app shortcuts:
  Tab              switch panes (Explorer / Editor / Claude)
  ${K('P')}           fuzzy file search
  ${K('A')}           toggle Claude side panel
  ${K('G')}           git explorer (commits + files + diff)
  ${K('Enter')}       open the selected folder as the project root
  ${KA('Enter')}       pick a folder at this level to open as root
  ${K('Backspace')}   go up to the parent folder
  ${KS('C')}          clone a GitHub repo into the current folder
  ${K('N')}           (in chat) new conversation
  ${K('C')}           copy the selected lines in the editor
  Shift+↑/↓        extend line selection in editor
  d / w            toggle theme / line wrap
  Esc              close modal / clear selection
  ${K('Q')}           quit
`;

// The canonical install one-liner (kept in sync with README / install.sh).
const INSTALL_CMD =
  'curl -fsSL https://raw.githubusercontent.com/adavance-it/tcode/main/install.sh | bash';

const args = process.argv.slice(2);

// `tcode update`: re-run the install one-liner (clone/pull + link).
if (args[0] === 'update') {
  process.stdout.write('tcode: updating via the install script…\n\n');
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

// Launch Electron fully detached (own session, no inherited stdio) so the app
// keeps running after the terminal that started it is closed. The launcher
// then unrefs the child and exits right away.
const child = spawn(electronPath, electronArgs, {
  detached: true,
  stdio: 'ignore',
});
child.on('error', (err) => {
  process.stderr.write(`tcode: failed to launch Electron: ${err.message}\n`);
  process.exit(1);
});
child.unref();
