import * as blessed from 'blessed';
import * as fs from 'fs';
import * as path from 'path';
import { highlight, supportsLanguage } from 'cli-highlight';
import { Theme, bgAnsi } from './theme';

const EXT_TO_LANG: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescript',
  '.js': 'javascript', '.jsx': 'javascript',
  '.mjs': 'javascript', '.cjs': 'javascript',
  '.java': 'java', '.kt': 'kotlin', '.scala': 'scala', '.groovy': 'groovy',
  '.py': 'python', '.rb': 'ruby', '.go': 'go', '.rs': 'rust',
  '.c': 'c', '.h': 'c', '.cpp': 'cpp', '.hpp': 'cpp', '.cc': 'cpp',
  '.cs': 'csharp', '.swift': 'swift', '.php': 'php', '.m': 'objectivec',
  '.html': 'html', '.htm': 'html', '.css': 'css', '.scss': 'scss', '.less': 'less',
  '.json': 'json', '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'toml',
  '.md': 'markdown', '.sh': 'bash', '.bash': 'bash', '.zsh': 'bash',
  '.sql': 'sql', '.xml': 'xml', '.dockerfile': 'dockerfile',
  '.lua': 'lua', '.r': 'r', '.dart': 'dart', '.ex': 'elixir', '.exs': 'elixir',
};

const MAX_FILE_BYTES = 2 * 1024 * 1024;

function detectLanguage(filePath: string): string | undefined {
  const base = path.basename(filePath).toLowerCase();
  if (base === 'dockerfile') return 'dockerfile';
  if (base === 'makefile') return 'makefile';
  const ext = path.extname(filePath).toLowerCase();
  return EXT_TO_LANG[ext];
}

function isLikelyBinary(buf: Buffer): boolean {
  const len = Math.min(buf.length, 1024);
  for (let i = 0; i < len; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

export interface ViewerOpts {
  wrap?: boolean;
}

export class Viewer {
  box: blessed.Widgets.BoxElement;
  currentFile: string | null = null;
  wrap: boolean;
  private theme: Theme;
  private highlightedLine?: number;
  private rawText: string = '';
  private rawLines: string[] = [];
  selectionAnchor?: number;
  selectionActive?: number;
  onFileChange: (filePath: string | null) => void = () => {};
  onWrapChange: (wrap: boolean) => void = () => {};
  onSelectionChange: () => void = () => {};

  private welcomeText = [
    '',
    '   tercode - read-only code explorer',
    '',
    '   Pick a file in the Explorer (Enter) to view its content.',
    '',
    '   Shortcuts:',
    '     Tab           switch between Explorer and Editor',
    '     Enter         open file / toggle directory',
    '     Ctrl+P        fuzzy file search',
    '     Ctrl+A        ask Claude about this codebase',
    '     j/k or ↑/↓    move',
    '     g / G         top / bottom of file',
    '     w             toggle line wrap',
    '     q / Ctrl+C    quit',
    '',
  ].join('\n');

  constructor(screen: blessed.Widgets.Screen, theme: Theme, opts: ViewerOpts = {}) {
    this.theme = theme;
    this.wrap = opts.wrap ?? true;
    this.box = blessed.box({
      parent: screen,
      label: ' Editor ',
      top: 0,
      left: '30%',
      width: '70%',
      height: '100%-1',
      border: 'line',
      keys: true,
      vi: true,
      mouse: true,
      scrollable: true,
      alwaysScroll: true,
      tags: false,
      wrap: this.wrap,
      scrollbar: {
        ch: ' ',
        track: { bg: theme.scrollbarTrackBg },
        style: { bg: theme.scrollbarBg },
      },
      style: {
        focus: { border: { fg: theme.borderFocusFg } },
        border: { fg: theme.borderFg },
      },
      content: this.welcomeText,
    });

    this.box.key(['g'], () => {
      this.box.scrollTo(0);
      this.box.screen.render();
    });
    this.box.key(['S-g'], () => {
      this.box.setScrollPerc(100);
      this.box.screen.render();
    });
    this.box.key(['pageup', 'C-u'], () => {
      const h = (this.box.height as number) || 20;
      this.box.scroll(-Math.floor(h / 2));
      this.box.screen.render();
    });
    this.box.key(['pagedown', 'C-d'], () => {
      const h = (this.box.height as number) || 20;
      this.box.scroll(Math.floor(h / 2));
      this.box.screen.render();
    });
    this.box.key(['w'], () => this.toggleWrap());

    // selection: Shift+arrows / Shift+J / Shift+K
    this.box.key(['S-down', 'S-j'], () => this.extendSelection(1));
    this.box.key(['S-up', 'S-k'], () => this.extendSelection(-1));
    this.box.key(['escape'], () => this.clearSelection());

    // mouse: click sets anchor, shift+click extends
    this.box.on('mousedown', (data: any) => {
      const line = this.lineFromY(data.y);
      if (line == null) return;
      if (data.shift) {
        if (this.selectionAnchor == null) this.selectionAnchor = line;
        this.selectionActive = line;
      } else {
        this.selectionAnchor = line;
        this.selectionActive = line;
      }
      this.rerender();
      this.onSelectionChange();
    });
  }

  hasSelection(): boolean {
    return this.selectionAnchor != null && this.selectionActive != null
      && this.selectionAnchor !== this.selectionActive;
  }

  selectionRange(): [number, number] | null {
    if (this.selectionAnchor == null || this.selectionActive == null) return null;
    return [
      Math.min(this.selectionAnchor, this.selectionActive),
      Math.max(this.selectionAnchor, this.selectionActive),
    ];
  }

  selectionText(): string {
    const r = this.selectionRange();
    if (!r) return '';
    return this.rawLines.slice(r[0] - 1, r[1]).join('\n');
  }

  clearSelection() {
    if (this.selectionAnchor == null && this.selectionActive == null) return;
    this.selectionAnchor = undefined;
    this.selectionActive = undefined;
    this.rerender();
    this.onSelectionChange();
  }

  private extendSelection(delta: number) {
    if (!this.rawLines.length) return;
    if (this.selectionAnchor == null) {
      const start = ((this.box as any).childBase ?? 0) + 1;
      this.selectionAnchor = start;
      this.selectionActive = start;
    }
    const max = this.rawLines.length;
    this.selectionActive = Math.max(1, Math.min(max, (this.selectionActive ?? 1) + delta));
    this.scrollToLine(this.selectionActive);
    this.rerender();
    this.onSelectionChange();
  }

  private lineFromY(y: number): number | null {
    if (!this.rawLines.length) return null;
    const top = (this.box.atop as number) + 1; // border
    const childBase = (this.box as any).childBase ?? 0;
    const row = y - top;
    if (row < 0) return null;
    const line = childBase + row + 1;
    if (line < 1 || line > this.rawLines.length) return null;
    return line;
  }

  private rerender() {
    if (!this.currentFile || !this.rawText) {
      this.box.screen.render();
      return;
    }
    this.box.setContent(this.formatContent());
    this.box.screen.render();
  }

  private formatContent(): string {
    return this.withLineNumbers(this.rawText, this.highlightedLine);
  }

  toggleWrap() {
    this.wrap = !this.wrap;
    (this.box as any).wrap = this.wrap;
    if (this.currentFile) this.load(this.currentFile, this.highlightedLine);
    else this.box.screen.render();
    this.onWrapChange(this.wrap);
  }

  load(filePath: string, line?: number) {
    this.highlightedLine = line && line > 0 ? line : undefined;
    this.selectionAnchor = undefined;
    this.selectionActive = undefined;

    let content: string;
    let raw = '';
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) {
        content = `Not a regular file.`;
      } else if (stat.size > MAX_FILE_BYTES) {
        content = `File too large to display (${(stat.size / 1024).toFixed(0)} KB).`;
      } else {
        const buf = fs.readFileSync(filePath);
        if (isLikelyBinary(buf)) {
          content = `Binary file (${stat.size} bytes) — preview disabled.`;
        } else {
          raw = buf.toString('utf8');
          let text = raw;
          const lang = detectLanguage(filePath);
          if (lang && supportsLanguage(lang)) {
            try {
              text = highlight(text, { language: lang, ignoreIllegals: true });
            } catch {
              /* fall back to plain text */
            }
          }
          this.rawText = text;
          this.rawLines = raw.split('\n');
          content = this.withLineNumbers(text, this.highlightedLine);
        }
      }
    } catch (e: any) {
      content = `Error reading file: ${e.message}`;
    }

    if (!raw) {
      this.rawText = '';
      this.rawLines = [];
    }
    this.currentFile = filePath;
    this.box.setLabel(' ' + path.basename(filePath) + ' ');
    this.box.setContent(content);
    this.box.scrollTo(0);
    if (this.highlightedLine && this.highlightedLine > 1) {
      this.scrollToLine(this.highlightedLine);
    }
    this.onFileChange(filePath);
    this.box.screen.render();
  }

  private withLineNumbers(content: string, hl?: number): string {
    const lines = content.split('\n');
    const width = String(lines.length).length;
    const hlBg = hl ? bgAnsi(this.theme.highlightLineBg) : '';
    const selRange = this.selectionRange();
    const selBg = selRange ? bgAnsi(this.theme.selectedBg) : '';
    return lines
      .map((l, i) => {
        const num = String(i + 1).padStart(width, ' ');
        const lineNum = i + 1;
        if (selRange && lineNum >= selRange[0] && lineNum <= selRange[1]) {
          // cli-highlight only flips fg, so our bg persists through inner codes
          return `${selBg}\x1b[97m  ${num}\x1b[39m  ${l}\x1b[0m`;
        }
        if (hl === lineNum) {
          return `${hlBg}\x1b[33m▸ ${num}\x1b[39m  ${l}\x1b[0m`;
        }
        return `  \x1b[90m${num}\x1b[39m  ${l}`;
      })
      .join('\n');
  }

  scrollToLine(line: number) {
    const h = (this.box.height as number) || 20;
    const target = Math.max(0, line - Math.floor(h / 3));
    this.box.scrollTo(target);
    this.box.screen.render();
  }

  focus() {
    this.box.focus();
  }
}
