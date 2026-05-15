import * as blessed from 'blessed';
import * as fs from 'fs';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { highlight, supportsLanguage } from 'cli-highlight';
import { Theme } from './theme';
import { applyListThemeStyles } from './viewer';
import { wheelScrollsViewportOnly, clickSelectsInPlace } from './listmouse';

export interface FileRef {
  path: string;
  rel: string;
  line?: number;
}

// One clickable region inside the rendered answer. Coords are content row /
// visible column. We do our own word-wrap so visible row == content row.
interface RefHit {
  row: number;
  col: number;
  length: number;
  ref: FileRef;
}

// Same idea but scoped to a single (pre-wrap) logical line; the wrap pass
// remaps these to RefHits with absolute rows.
interface LineHit {
  col: number;
  length: number;
  ref: FileRef;
}

// Logical line emitted by renderMarkdown before wrapping. `wrap: false` is for
// code-block content / fence markers — wrapping those would corrupt the
// indentation and the syntax-highlighted layout.
interface LogicalLine {
  rendered: string;
  hits: LineHit[];
  wrap: boolean;
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
  private refHits: RefHit[] = [];
  private streamingText = '';
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
      // wrap:false so each rendered line corresponds 1:1 to a visible row,
      // which is what the click→ref-hit mapping below relies on.
      wrap: false,
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

    // Wheel scrolls the refs list; a click opens that ref.
    wheelScrollsViewportOnly(this.refsBox);
    clickSelectsInPlace(this.refsBox, idx => {
      const r = this.refs[idx];
      if (r) this.onOpenFile(r.path, r.line);
    });

    // Click on a styled ref inside the answer → open it in the editor.
    this.output.on('mousedown', (data: any) => {
      const top = (this.output.atop as number) ?? 0;
      const left = (this.output.aleft as number) ?? 0;
      const itop = ((this.output as any).itop as number) ?? 1;
      const ileft = ((this.output as any).ileft as number) ?? 1;
      const childBase = ((this.output as any).childBase as number) ?? 0;
      const row = data.y - top - itop + childBase;
      const col = data.x - left - ileft;
      if (col < 0) return;
      const hit = this.refHits.find(h =>
        h.row === row && col >= h.col && col < h.col + h.length
      );
      if (hit) this.onOpenFile(hit.ref.path, hit.ref.line);
    });

    // Re-wrap the answer when the panel is resized (chat splitter drag or
    // terminal resize) so the line widths stay in sync with the box.
    this.output.on('resize', () => this.rewrapAnswer());

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
    this.refHits = [];
    this.streamingText = '';
    this.refsBox.setItems(['(waiting for answer...)']);
    this.output.setContent('Asking Claude...\n\n');
    this.screen.render();

    let prompt =
      `You are helping a user explore a codebase from inside a TUI code\n` +
      `viewer. Your answer is rendered with a small markdown subset: headings,\n` +
      `lists, **bold**, *italic*, \`inline code\`, and fenced code blocks\n` +
      `(\`\`\`lang ... \`\`\`) with syntax highlighting. Refs of the form\n` +
      `\`path/to/file.ext:LINE\` are turned into clickable hyperlinks that\n` +
      `jump the user's editor pane to that exact line.\n\n` +
      `HARD REQUIREMENTS for your answer:\n` +
      `- Concise (under 250 words).\n` +
      `- WHENEVER you mention any specific code construct — function, method,\n` +
      `  class, type, constant, endpoint, route, command, schema field, env\n` +
      `  var, config key, file, etc. — you MUST hyperlink it as\n` +
      `  \`path/to/file.ext:LINE\`. The path MUST be relative to the user's\n` +
      `  current working directory. The line number MUST point at the\n` +
      `  construct's definition (or, if you're describing a usage, the most\n` +
      `  relevant call site).\n` +
      `- Link every construct individually. Do not aggregate ("see foo.ts");\n` +
      `  give exact \`file:LINE\` for each one.\n` +
      `- Verify the line numbers against the actual file before answering.\n` +
      `  If you're not sure of an exact line, grep / read the file first.\n` +
      `- Use fenced code blocks for any quoted code so it gets highlighted.\n\n`;
    if (this.pendingContext) {
      const rel = path.relative(this.root, this.pendingContext.file);
      prompt += `The user has selected the following lines from \`${rel}\` ` +
        `(lines ${this.pendingContext.range[0]}-${this.pendingContext.range[1]}):\n\n` +
        '```\n' + this.pendingContext.text + '\n```\n\n';
    }
    prompt += `Question: ${q}`;

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
      this.streamingText += d.toString();
      this.updateAnswer();
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
      if ((code !== 0 && code !== null) && !this.streamingText) {
        this.output.setContent(`claude exited with code ${code}\n\n${stderr}`);
        this.screen.render();
        return;
      }
      this.lastAnswer = this.streamingText;
      this.hasConversation = true;
      this.updateAnswer();
      if (this.refs.length) this.refsBox.select(0);
    });
  }

  // Re-renders the answer area with markdown styling and ref hit-testing.
  // Called both during streaming and on close.
  private updateAnswer() {
    this.refs = this.parseRefs(this.streamingText);
    const { rendered, hits } = this.renderMarkdown(this.streamingText);
    this.refHits = hits;
    this.output.setContent(rendered);
    this.output.setScrollPerc(100);
    if (this.refs.length) {
      this.refsBox.setItems(
        this.refs.map(r => (r.line ? `${r.rel}:${r.line}` : r.rel))
      );
    } else {
      this.refsBox.setItems(this.streamingText ? ['(no file references found in answer)'] : []);
    }
    this.screen.render();
  }

  // Minimal markdown → ANSI converter. Handles headings, lists, **bold**,
  // *italic*, `inline code`, fenced code (```lang ... ```) with cli-highlight,
  // and detects refs (path/to/file.ext[:LINE]) — refs that match parsed
  // entries in this.refs are styled distinctly and recorded as hits.
  // After per-line rendering, every wrappable line is word-wrapped at the
  // current output width with its leading whitespace re-applied to
  // continuation rows; ref hits are remapped to their post-wrap (row, col).
  private renderMarkdown(text: string): { rendered: string; hits: RefHit[] } {
    const logical: LogicalLine[] = [];
    let inCode = false;
    let codeLang = '';
    let codeLines: string[] = [];

    const flushCode = () => {
      let body = codeLines.join('\n');
      if (codeLang && supportsLanguage(codeLang)) {
        try { body = highlight(body, { language: codeLang, ignoreIllegals: true }); }
        catch { /* fall back to plain */ }
      }
      for (const cl of body.split('\n')) {
        logical.push({ rendered: '  ' + cl, hits: [], wrap: false });
      }
    };

    for (const line of text.split('\n')) {
      if (!inCode) {
        const fence = line.match(/^```(\w*)\s*$/);
        if (fence) {
          inCode = true;
          codeLang = fence[1];
          codeLines = [];
          logical.push({ rendered: '\x1b[2m' + line + '\x1b[0m', hits: [], wrap: false });
          continue;
        }
      } else {
        if (line.trim() === '```') {
          flushCode();
          logical.push({ rendered: '\x1b[2m```\x1b[0m', hits: [], wrap: false });
          inCode = false;
          continue;
        }
        codeLines.push(line);
        continue;
      }

      const heading = line.match(/^(#{1,6})\s+(.+)$/);
      if (heading) {
        const lvl = heading[1].length;
        const txt = heading[2];
        const c = lvl === 1 ? '\x1b[1;33m' : lvl === 2 ? '\x1b[1;36m' : '\x1b[1m';
        logical.push({ rendered: c + txt + '\x1b[0m', hits: [], wrap: true });
        continue;
      }

      const li = line.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
      if (li) {
        const indent = li[1];
        const marker = li[2];
        const rest = li[3];
        const bullet = (marker === '-' || marker === '*') ? '•' : marker;
        const prefix = indent + '\x1b[33m' + bullet + '\x1b[39m ';
        const startCol = indent.length + bullet.length + 1;
        const sub = this.renderInline(rest, startCol);
        logical.push({ rendered: prefix + sub.rendered, hits: sub.hits, wrap: true });
        continue;
      }

      const sub = this.renderInline(line, 0);
      logical.push({ rendered: sub.rendered, hits: sub.hits, wrap: true });
    }

    if (inCode) flushCode(); // unclosed fence: render what we have

    // Word-wrap pass: emit final rows + remapped hits.
    const width = this.outputWidth();
    const allLines: string[] = [];
    const allHits: RefHit[] = [];
    for (const ll of logical) {
      const baseRow = allLines.length;
      if (!ll.wrap) {
        allLines.push(ll.rendered);
        for (const h of ll.hits) {
          allHits.push({ row: baseRow, col: h.col, length: h.length, ref: h.ref });
        }
        continue;
      }
      const wrapped = wrapLine(ll.rendered, ll.hits, width);
      for (const wl of wrapped.lines) allLines.push(wl);
      for (const h of wrapped.hits) {
        allHits.push({ row: baseRow + h.row, col: h.col, length: h.length, ref: h.ref });
      }
    }
    return { rendered: allLines.join('\n'), hits: allHits };
  }

  // Inner content of one source line. Returns the styled string plus per-line
  // ref hits keyed by the visible column at which each ref starts.
  private renderInline(text: string, startCol: number): { rendered: string; hits: LineHit[] } {
    const hits: LineHit[] = [];
    let result = '';
    let col = startCol;
    let i = 0;
    const REF_RE = /^([A-Za-z0-9_./@-]+\.[A-Za-z0-9]+)(?::(\d+))?/;

    while (i < text.length) {
      // **bold**
      if (text.startsWith('**', i)) {
        const end = text.indexOf('**', i + 2);
        if (end > i + 2) {
          const inner = text.slice(i + 2, end);
          result += '\x1b[1m' + inner + '\x1b[22m';
          col += inner.length;
          i = end + 2;
          continue;
        }
      }
      // `code` (and clickable ref inside backticks)
      if (text[i] === '`') {
        const end = text.indexOf('`', i + 1);
        if (end > i) {
          const inner = text.slice(i + 1, end);
          const m = inner.match(REF_RE);
          if (m && m[0] === inner) {
            const ref = this.findRefMatch(m[1], m[2] ? parseInt(m[2], 10) : undefined);
            if (ref) {
              result += '\x1b[4;36m' + inner + '\x1b[24;39m';
              hits.push({ col, length: inner.length, ref });
              col += inner.length;
              i = end + 1;
              continue;
            }
          }
          result += '\x1b[36m' + inner + '\x1b[39m';
          col += inner.length;
          i = end + 1;
          continue;
        }
      }
      // *italic* (single * not part of **)
      if (text[i] === '*' && text[i + 1] !== '*') {
        const end = text.indexOf('*', i + 1);
        if (end > i + 1 && text[end + 1] !== '*') {
          const inner = text.slice(i + 1, end);
          result += '\x1b[3m' + inner + '\x1b[23m';
          col += inner.length;
          i = end + 1;
          continue;
        }
      }
      // Bare ref (not in backticks)
      if (/[A-Za-z0-9_]/.test(text[i])) {
        const m = text.slice(i).match(REF_RE);
        if (m) {
          const ref = this.findRefMatch(m[1], m[2] ? parseInt(m[2], 10) : undefined);
          if (ref) {
            result += '\x1b[4;36m' + m[0] + '\x1b[24;39m';
            hits.push({ col, length: m[0].length, ref });
            col += m[0].length;
            i += m[0].length;
            continue;
          }
        }
      }
      result += text[i];
      col++;
      i++;
    }
    return { rendered: result, hits };
  }

  private outputWidth(): number {
    const w = (this.output.width as number) || 40;
    const iw = ((this.output as any).iwidth as number) ?? 2;
    return Math.max(20, w - iw);
  }

  private findRefMatch(rel: string, line?: number): FileRef | undefined {
    return this.refs.find(r => r.rel === rel && (line == null || r.line === line))
        ?? this.refs.find(r => r.rel === rel);
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

  private rewrapAnswer() {
    const src = this.streamingText || this.lastAnswer;
    if (!src) return;
    const { rendered, hits } = this.renderMarkdown(src);
    this.refHits = hits;
    this.output.setContent(rendered);
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

// ─── Word-wrap helpers ────────────────────────────────────────────────────

type WTok =
  | { type: 'ansi'; raw: string; vlen: 0; origCol: number }
  | { type: 'space'; raw: string; vlen: number; origCol: number }
  | { type: 'word'; raw: string; vlen: number; origCol: number };

const ANSI_RE = /\x1b\[[\d;]*m/;

function visibleLength(s: string): number {
  return s.replace(/\x1b\[[\d;]*m/g, '').length;
}

// Split a rendered (ANSI-laden) line into ansi / whitespace-run / word tokens.
// origCol is the visible column at which each token *starts* in the original
// line (ANSI tokens carry their parent's origCol since they don't advance it).
function tokenizeForWrap(s: string): WTok[] {
  const tokens: WTok[] = [];
  let i = 0;
  let origCol = 0;
  while (i < s.length) {
    if (s[i] === '\x1b') {
      const m = ANSI_RE.exec(s.slice(i));
      if (m && m.index === 0) {
        tokens.push({ type: 'ansi', raw: m[0], vlen: 0, origCol });
        i += m[0].length;
        continue;
      }
    }
    if (s[i] === ' ' || s[i] === '\t') {
      let j = i;
      while (j < s.length && (s[j] === ' ' || s[j] === '\t')) j++;
      tokens.push({ type: 'space', raw: s.slice(i, j), vlen: j - i, origCol });
      origCol += j - i;
      i = j;
      continue;
    }
    let j = i;
    while (j < s.length && s[j] !== ' ' && s[j] !== '\t' && s[j] !== '\x1b') j++;
    tokens.push({ type: 'word', raw: s.slice(i, j), vlen: j - i, origCol });
    origCol += j - i;
    i = j;
  }
  return tokens;
}

// Word-wrap a single rendered line at `width` visible columns. Continuation
// rows are prefixed with the line's leading whitespace + the ANSI codes that
// were active at the wrap point, so styles persist across rows. Per-line
// hits are remapped to (row, col) within the wrapped output.
function wrapLine(rendered: string, hits: LineHit[], width: number)
  : { lines: string[]; hits: { row: number; col: number; length: number; ref: FileRef }[] }
{
  if (visibleLength(rendered) <= width) {
    return {
      lines: [rendered],
      hits: hits.map(h => ({ row: 0, col: h.col, length: h.length, ref: h.ref })),
    };
  }

  // Strip leading ANSI to find the visible leading whitespace (= continuation
  // indent). Note: leading indent for the *first* row is already inside
  // `rendered`; we just re-apply it on subsequent rows.
  const stripped = rendered.replace(/^(?:\x1b\[[\d;]*m)+/, '');
  const indentMatch = stripped.match(/^[ \t]*/);
  const indent = indentMatch ? indentMatch[0] : '';

  const tokens = tokenizeForWrap(rendered);
  const lines: string[] = [];
  let cur = '';
  let curVlen = 0;
  let activeAnsi = '';
  let row = 0;
  // origCol → (row, col) for token starts; lets us remap hits afterwards.
  const colMap: Array<{ origCol: number; row: number; col: number }> = [];

  for (const tok of tokens) {
    if (tok.type === 'ansi') {
      cur += tok.raw;
      // Reset clears the active style stack; everything else accumulates.
      if (tok.raw === '\x1b[0m' || tok.raw === '\x1b[m') activeAnsi = '';
      else activeAnsi += tok.raw;
      continue;
    }

    if (curVlen + tok.vlen <= width) {
      colMap.push({ origCol: tok.origCol, row, col: curVlen });
      cur += tok.raw;
      curVlen += tok.vlen;
      continue;
    }

    // Doesn't fit on the current row.
    if (tok.type === 'space') {
      // Drop the space and start a new row.
      lines.push(cur);
      row++;
      cur = indent + activeAnsi;
      curVlen = indent.length;
      continue;
    }

    // A word that doesn't fit: push it onto a fresh continuation row.
    lines.push(cur);
    row++;
    cur = indent + activeAnsi;
    curVlen = indent.length;
    colMap.push({ origCol: tok.origCol, row, col: curVlen });
    cur += tok.raw;
    curVlen += tok.vlen;
  }
  lines.push(cur);

  // Remap each hit through colMap. We find the LAST token whose origCol <=
  // hit.col (the token containing the hit's start) and add the hit's offset
  // within that token. Refs are typically a single word so they don't span
  // a wrap boundary; if a ref were ever split, only the first row is hit-
  // testable, which degrades gracefully.
  const newHits: { row: number; col: number; length: number; ref: FileRef }[] = [];
  for (const h of hits) {
    let entry: { origCol: number; row: number; col: number } | null = null;
    for (const e of colMap) {
      if (e.origCol > h.col) break;
      entry = e;
    }
    if (!entry) continue;
    const offset = h.col - entry.origCol;
    newHits.push({
      row: entry.row,
      col: entry.col + offset,
      length: h.length,
      ref: h.ref,
    });
  }

  return { lines, hits: newHits };
}
