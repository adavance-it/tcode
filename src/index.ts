#!/usr/bin/env node
import * as path from 'path';
import { App } from './app';

const args = process.argv.slice(2);
let dir: string | undefined;
let wrap = true;

for (const a of args) {
  if (a === '--no-wrap') wrap = false;
  else if (a === '--wrap') wrap = true;
  else if (a === '-h' || a === '--help') {
    process.stdout.write(
      'Usage: tercode [--no-wrap | --wrap] [path]\n' +
      '\n' +
      'Options:\n' +
      '  --no-wrap    show long lines truncated instead of wrapped\n' +
      '  --wrap       wrap long lines (default)\n' +
      '\n' +
      'In-app shortcuts:\n' +
      '  Tab          switch panes\n' +
      '  Ctrl+P       fuzzy file search\n' +
      '  Ctrl+A       ask Claude\n' +
      '  w            toggle line wrap\n' +
      '  q            quit\n'
    );
    process.exit(0);
  } else if (!a.startsWith('-')) {
    dir = a;
  }
}

const root = dir ? path.resolve(dir) : process.cwd();
const app = new App(root, { wrap });
app.run();
