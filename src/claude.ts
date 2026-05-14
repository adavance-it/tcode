import * as blessed from 'blessed';
import * as fs from 'fs';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';

export interface FileRef {
  path: string;
  rel: string;
  line?: number;
}

export class ClaudeChat {
  private screen: blessed.Widgets.Screen;
  private root: string;
  private container: blessed.Widgets.BoxElement;
  private input: blessed.Widgets.TextboxElement;
  private output: blessed.Widgets.BoxElement;
  private refsBox: blessed.Widgets.ListElement;
  private hint: blessed.Widgets.BoxElement;
  private child: ChildProcess | null = null;
  private refs: FileRef[] = [];
  visible = false;
  onOpenFile: (filePath: string, line?: number) => void = () => {};

  constructor(screen: blessed.Widgets.Screen, root: string) {
    this.screen = screen;
    this.root = root;

    this.container = blessed.box({
      parent: screen,
      hidden: true,
      top: 'center',
      left: 'center',
      width: '85%',
      height: '85%',
      border: 'line',
      label: ' Ask Claude about this codebase ',
      style: { border: { fg: 'magenta' } },
      tags: false,
    });

    blessed.text({
      parent: this.container,
      top: 0,
      left: 1,
      content: 'Question (Enter to ask, Esc to close):',
      style: { fg: 'gray' },
    });

    this.input = blessed.textbox({
      parent: this.container,
      top: 1,
      left: 1,
      right: 1,
      height: 1,
      inputOnFocus: true,
      keys: true,
      mouse: true,
      style: { fg: 'white', bg: 'black' },
    });

    blessed.text({
      parent: this.container,
      top: 3,
      left: 1,
      content: 'Answer:',
      style: { fg: 'gray' },
    });

    this.output = blessed.box({
      parent: this.container,
      top: 4,
      left: 1,
      right: 1,
      height: '55%',
      border: 'line',
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      vi: true,
      mouse: true,
      tags: false,
      scrollbar: { ch: ' ', track: { bg: 'gray' }, style: { bg: 'magenta' } },
      style: {
        border: { fg: 'gray' },
        focus: { border: { fg: 'cyan' } },
      },
      content: '(Type a question above and press Enter)',
    });

    blessed.text({
      parent: this.container,
      top: '70%',
      left: 1,
      content: 'Referenced files (Tab to focus, Enter to open):',
      style: { fg: 'gray' },
    });

    this.refsBox = blessed.list({
      parent: this.container,
      top: '70%+1',
      left: 1,
      right: 1,
      bottom: 2,
      keys: true,
      vi: true,
      mouse: true,
      tags: false,
      border: 'line',
      style: {
        selected: { bg: 'magenta', fg: 'white' },
        border: { fg: 'gray' },
        focus: { border: { fg: 'cyan' } },
      },
    });

    this.hint = blessed.box({
      parent: this.container,
      bottom: 0,
      left: 1,
      right: 1,
      height: 1,
      tags: false,
      style: { fg: 'gray' },
      content: 'Tab: cycle Question / Answer / References   Esc: close   Enter on a file: open it',
    });

    this.input.on('submit', () => this.ask());
    this.input.on('cancel', () => this.hide());
    this.input.key(['escape'], () => this.hide());
    this.output.key(['escape'], () => this.hide());
    this.refsBox.key(['escape'], () => this.hide());

    this.input.key(['tab'], () => this.output.focus());
    this.output.key(['tab'], () => this.refsBox.focus());
    this.refsBox.key(['tab'], () => this.focusInput());

    this.refsBox.on('select', (_item: any, idx: number) => {
      const r = this.refs[idx];
      if (!r) return;
      this.hide();
      this.onOpenFile(r.path, r.line);
    });
  }

  show() {
    this.visible = true;
    this.container.show();
    this.container.setFront();
    this.input.setValue('');
    this.output.setContent('(Type a question above and press Enter)');
    this.refsBox.setItems([]);
    this.refs = [];
    this.focusInput();
    this.screen.render();
  }

  private focusInput() {
    this.input.focus();
    (this.input as any).readInput();
  }

  hide() {
    if (!this.visible) return;
    this.visible = false;
    if (this.child && !this.child.killed) {
      try { this.child.kill('SIGTERM'); } catch { /* ignore */ }
    }
    (this.input as any).cancel?.();
    this.container.hide();
    this.screen.render();
  }

  private ask() {
    const q = this.input.getValue().trim();
    if (!q) return;

    this.refs = [];
    this.refsBox.setItems(['(waiting for answer...)']);
    this.output.setContent('Asking Claude...\n\n');
    this.screen.render();

    const prompt =
      `You are helping a user explore a codebase from the terminal. ` +
      `Answer the user's question concisely (under 250 words). ` +
      `Whenever possible, reference specific files using paths relative to the current working directory, ` +
      `formatted as \`path/to/file.ext:LINE\` so the user can jump to them.\n\n` +
      `Question: ${q}`;

    let stdout = '';
    let stderr = '';

    try {
      this.child = spawn('claude', ['-p', prompt], {
        cwd: this.root,
        env: process.env,
      });
    } catch (e: any) {
      this.output.setContent(`Failed to spawn claude: ${e.message}`);
      this.refsBox.setItems(['(claude CLI not available)']);
      this.screen.render();
      return;
    }

    this.child.stdout?.on('data', (d: Buffer) => {
      stdout += d.toString();
      this.output.setContent(stdout);
      this.output.setScrollPerc(100);
      this.screen.render();
    });
    this.child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    this.child.on('error', (err: Error) => {
      this.output.setContent(
        `Error running 'claude': ${err.message}\n\n` +
        `Make sure the Claude Code CLI is installed and on your PATH.`
      );
      this.refsBox.setItems(['(error)']);
      this.screen.render();
    });
    this.child.on('close', (code: number | null) => {
      this.child = null;
      if ((code !== 0 && code !== null) && !stdout) {
        this.output.setContent(`claude exited with code ${code}\n\n${stderr}`);
      }
      this.refs = this.parseRefs(stdout);
      if (this.refs.length) {
        this.refsBox.setItems(
          this.refs.map(r => (r.line ? `${r.rel}:${r.line}` : r.rel))
        );
        this.refsBox.select(0);
      } else {
        this.refsBox.setItems(['(no file references found in answer)']);
      }
      this.screen.render();
    });
  }

  private parseRefs(text: string): FileRef[] {
    const seen = new Set<string>();
    const refs: FileRef[] = [];
    const regex = /[`"'(\[]?([A-Za-z0-9_./@-]+\.[A-Za-z0-9]+)(?::(\d+))?[`"')\]]?/g;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text))) {
      const rel = m[1];
      const line = m[2] ? parseInt(m[2], 10) : undefined;
      if (!rel || rel.startsWith('http') || rel.startsWith('//')) continue;
      if (rel.length > 256) continue;
      let abs = path.isAbsolute(rel) ? rel : path.resolve(this.root, rel);
      if (!abs.startsWith(this.root + path.sep) && abs !== this.root) continue;
      const key = abs + (line ? ':' + line : '');
      if (seen.has(key)) continue;
      try {
        const stat = fs.statSync(abs);
        if (!stat.isFile()) continue;
      } catch {
        continue;
      }
      seen.add(key);
      refs.push({ path: abs, rel: path.relative(this.root, abs), line });
    }
    return refs;
  }
}
