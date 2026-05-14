#!/usr/bin/env node
import * as path from 'path';
import { App } from './app';
import { ThemeChoice } from './theme';

const args = process.argv.slice(2);
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
      'Usage: tercode [options] [path]\n' +
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
      '  Ctrl+A       ask Claude (uses current selection as context)\n' +
      '  Ctrl+G       git explorer (commits + diffs)\n' +
      '  Ctrl+N       (in chat) new conversation\n' +
      '  Shift+↑/↓    extend line selection in editor\n' +
      '  Shift+click  extend selection to clicked line\n' +
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

const root = dir ? path.resolve(dir) : process.cwd();
const app = new App(root, { wrap, theme });
app.run();
