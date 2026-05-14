import * as blessed from 'blessed';
import * as fs from 'fs';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { Theme } from './theme';
import { applyListThemeStyles } from './viewer';

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
  private contextLabel: blessed.Widgets.BoxElement;
  private pendingContext?: { file: string; range: [number, number]; text: string };
  private hasConversation = false;
  private lastQuestion = '';
  private lastAnswer = '';
  visible = false;
  onOpenFile: (filePath: string, line?: number) => void = () => {};
  onShow: () => void = () => {};
  onHide: () => void = () => {};
  // Esc inside the chat just yields focus back to the editor; the panel stays open.
  // Use Ctrl+A from anywhere to actually toggle visibility.
  onDefocus: () => void = () => {};

  constructor(screen: blessed.Widgets.Screen, root: string, theme: Theme) {
    this.screen = screen;
    this.root = root;

    // Inline right-side panel. Anchor with `right: 0` (not `width`) and use
    // numeric `bottom` (not a percent expression) so blessed's coord resolver
    // never has to evaluate string positions on the container — that path is
    // what causes RangeError in _getLeft/aleft when the panel goes visible.
    const sw = (screen.width as number) || 80;
    const initialLeft = Math.max(0, sw - Math.max(30, Math.round(sw * 0.35)));
    this.container = blessed.box({
      parent: screen,
      hidden: true,
      top: 0,
      left: initialLeft,
      right: 0,
      bottom: 1,
      border: 'line',
      label: ' Claude ',
      style: {
        border: { fg: theme.borderFg },
        focus: { border: { fg: theme.borderFocusFg } },
      },
      tags: false,
    });

    // All children use only numeric positions (no `%` expressions). blessed's
    // percent parsing inside a dynamically-resized box is the most likely
    // source of the recursion users have hit on macOS terminals.
    blessed.text({
      parent: this.container,
      top: 0,
      left: 1,
      height: 1,
      content: 'Question:',
      style: { fg: 'gray' },
    });

    // NOTE: no `inputOnFocus: true`. With it, blessed's blur handler calls
    // screen.rewindFocus(), which can recurse infinitely with screen._focus
    // when the input loses focus to another focusable sibling (output / refs).
    // We call readInput() explicitly in focusInput() instead.
    this.input = blessed.textbox({
      parent: this.container,
      top: 1,
      left: 1,
      right: 1,
      height: 1,
      keys: true,
      mouse: true,
      style: { fg: theme.statusFg, bg: theme.dimBg },
    });

    this.contextLabel = blessed.box({
      parent: this.container,
      top: 2,
      left: 1,
      right: 1,
      height: 1,
      tags: false,
      style: { fg: 'yellow' },
      content: '',
    });

    blessed.text({
      parent: this.container,
      top: 3,
      left: 1,
      height: 1,
      content: 'Answer:',
      style: { fg: 'gray' },
    });

    this.output = blessed.box({
      parent: this.container,
      top: 4,
      left: 1,
      right: 1,
      bottom: 11,
      border: 'line',
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      vi: true,
      mouse: true,
      tags: false,
      scrollbar: {
        ch: ' ',
        track: { bg: theme.scrollbarTrackBg },
        style: { bg: theme.scrollbarBg },
      },
      style: {
        border: { fg: theme.borderFg },
        focus: { border: { fg: theme.borderFocusFg } },
      },
      content: '(Type a question above and press Enter)',
    });

    blessed.text({
      parent: this.container,
      bottom: 10,
      left: 1,
      height: 1,
      content: 'Refs:',
      style: { fg: 'gray' },
    });

    this.refsBox = blessed.list({
      parent: this.container,
      bottom: 1,
      left: 1,
      right: 1,
      height: 9,
      keys: true,
      vi: true,
      mouse: true,
      tags: false,
      border: 'line',
      style: {
        selected: { bg: theme.selectedBg, fg: theme.selectedFg },
        border: { fg: theme.borderFg },
        focus: { border: { fg: theme.borderFocusFg } },
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
      content: '^N new  •  Tab cycle  •  ^A close  •  Esc → editor',
    });

    this.input.on('submit', () => this.ask());
    // Re-implement `inputOnFocus`'s focus→readInput half WITHOUT its
    // blur→rewindFocus half (the part that loops with Screen._focus).
    this.input.on('focus', () => {
      if (!(this.input as any)._reading) (this.input as any).readInput();
    });
    // NOTE: we deliberately do NOT listen to 'cancel'. blessed emits 'cancel'
    // on every blur of a textbox in readInput mode — including the blur that
    // happens when the user presses Tab to move to `output` or `refsBox`. If
    // we treated 'cancel' as "user wants to leave the chat", Tab would yank
    // them back to the editor. Esc is bound explicitly below.
    this.input.key(['escape'], () => this.onDefocus());
    this.output.key(['escape'], () => this.onDefocus());
    this.refsBox.key(['escape'], () => this.onDefocus());

    this.input.key(['tab'], () => this.output.focus());
    this.output.key(['tab'], () => this.refsBox.focus());
    this.refsBox.key(['tab'], () => this.focusInput());

    this.input.key(['C-n'], () => this.newConversation());
    this.output.key(['C-n'], () => this.newConversation());
    this.refsBox.key(['C-n'], () => this.newConversation());

    this.refsBox.on('select', (_item: any, idx: number) => {
      const r = this.refs[idx];
      if (!r) return;
      // Don't hide — chat is a side pane and stays open. The viewer will be
      // refocused by App's onOpenFile handler.
      this.onOpenFile(r.path, r.line);
    });

    // Detach from the screen until first show(). Even hidden, a mounted
    // textbox can be picked up by blessed's focus pass at startup; the
    // resulting blur loop is what was crashing tcode on macOS.
    this.screen.remove(this.container);
  }

  show(opts: { context?: { file: string; range: [number, number]; text: string } } = {}) {
    if (!this.container.parent) this.screen.append(this.container);
    this.visible = true;
    this.onShow();
    this.container.show();
    this.input.setValue('');
    if (opts.context) {
      this.pendingContext = opts.context;
      const rel = path.relative(this.root, opts.context.file);
      this.contextLabel.setContent(
        ` Context: ${rel}:${opts.context.range[0]}-${opts.context.range[1]} ` +
        `(${opts.context.range[1] - opts.context.range[0] + 1} lines) — will be sent with your question`
      );
    } else {
      this.pendingContext = undefined;
      this.contextLabel.setContent('');
    }
    if (!this.hasConversation) {
      this.output.setContent('(Type a question above and press Enter)');
      this.refsBox.setItems([]);
      this.refs = [];
    }
    this.focusInput();
    this.container.setFront();
    this.screen.render();
  }

  newConversation() {
    this.hasConversation = false;
    this.lastQuestion = '';
    this.lastAnswer = '';
    this.refs = [];
    this.pendingContext = undefined;
    this.input.setValue('');
    this.contextLabel.setContent('');
    this.output.setContent('(Type a question above and press Enter)');
    this.refsBox.setItems([]);
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
    this.onHide();
    this.screen.render();
  }

  private ask() {
    const q = this.input.getValue().trim();
    if (!q) return;

    this.lastQuestion = q;
    this.refs = [];
    this.refsBox.setItems(['(waiting for answer...)']);
    this.output.setContent('Asking Claude...\n\n');
    this.screen.render();

    let prompt =
      `You are helping a user explore a codebase from the terminal. ` +
      `Answer the user's question concisely (under 250 words). ` +
      `Whenever possible, reference specific files using paths relative to the current working directory, ` +
      `formatted as \`path/to/file.ext:LINE\` so the user can jump to them.\n\n`;
    if (this.pendingContext) {
      const rel = path.relative(this.root, this.pendingContext.file);
      prompt += `The user has selected the following lines from \`${rel}\` ` +
        `(lines ${this.pendingContext.range[0]}-${this.pendingContext.range[1]}):\n\n` +
        '```\n' + this.pendingContext.text + '\n```\n\n';
    }
    prompt += `Question: ${q}`;

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
      this.lastAnswer = stdout;
      this.hasConversation = true;
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

  setBounds(left: number, _width: number) {
    // Container is anchored with right:0; width derives implicitly. We only
    // need to move its left edge.
    (this.container as any).left = left;
  }

  applyTheme(theme: Theme) {
    const c: any = this.container;
    if (c.style?.border) c.style.border.fg = theme.borderFg;
    if (c.style?.focus?.border) c.style.focus.border.fg = theme.borderFocusFg;
    const o: any = this.output;
    if (o.style?.border) o.style.border.fg = theme.borderFg;
    if (o.style?.focus?.border) o.style.focus.border.fg = theme.borderFocusFg;
    if (o.scrollbar?.style) o.scrollbar.style.bg = theme.scrollbarBg;
    if (o.scrollbar?.track) o.scrollbar.track.bg = theme.scrollbarTrackBg;
    applyListThemeStyles(this.refsBox as any, theme);
    this.screen.render();
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
