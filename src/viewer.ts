import * as blessed from 'blessed';
import * as fs from 'fs';
import * as path from 'path';
import { highlight, supportsLanguage } from 'cli-highlight';
import { Theme, bgAnsi, fgAnsi } from './theme';

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
  // Horizontal scroll offset, in visible columns, applied to the code portion
  // of every line (the line-number gutter stays fixed). Only meaningful with
  // wrap off.
  hScroll = 0;
  private maxLineWidth = 0;
  private theme: Theme;
  private highlightedLine?: number;
  private rawText: string = '';
  private rawLines: string[] = [];
  selectionAnchor?: number;
  selectionActive?: number;
  private draggingSel = false;
  onFileChange: (filePath: string | null) => void = () => {};
  onWrapChange: (wrap: boolean) => void = () => {};
  onSelectionChange: () => void = () => {};
  onHScrollChange: () => void = () => {};

  private welcomeText = [
    '',
    '   tcode - read-only code explorer',
    '',
    '   Pick a file in the Explorer (Enter) to view its content.',
    '',
    '   Shortcuts:',
    '     Tab            switch between Explorer and Editor',
    '     Enter          open file / toggle directory',
    '     Ctrl+P         fuzzy file search',
    '     Ctrl+A         toggle Claude side panel (drag splitter to resize)',
    '     Ctrl+G         git explorer (commits + files + diff)',
    '     j/k or ↑/↓     move',
    '     g / G          top / bottom of file',
    '     Shift+↑/↓      extend line selection (or drag with mouse)',
    '     Shift+wheel    scroll horizontally (when wrap is off)',
    '     w              toggle line wrap (off by default)',
    '     d              toggle dark / light theme',
    '     q / Ctrl+C     quit',
    '',
  ].join('\n');

  constructor(screen: blessed.Widgets.Screen, theme: Theme, opts: ViewerOpts = {}) {
    this.theme = theme;
    this.wrap = opts.wrap ?? false;
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

    // mouse: click sets anchor, shift+click extends, drag extends to drop point
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
      this.draggingSel = true;
      this.rerender();
      this.onSelectionChange();
    });

    this.box.on('mousemove', (data: any) => {
      if (!this.draggingSel) return;
      const line = this.lineFromY(data.y);
      if (line == null || line === this.selectionActive) return;
      this.selectionActive = line;
      this.rerender();
      this.onSelectionChange();
    });

    this.box.on('mouseup', () => { this.draggingSel = false; });
    // mouseup outside the box fires on the screen; cover that too
    screen.on('mouseup', () => { this.draggingSel = false; });

    // Wheel: plain wheel scrolls vertically; Shift+wheel scrolls horizontally.
    // We replace blessed's default wheel→vertical-scroll so a Shift+wheel does
    // ONLY the horizontal move (no stray vertical jump).
    for (const ev of ['wheelup', 'wheeldown', 'element wheelup', 'element wheeldown']) {
      (this.box as any).removeAllListeners(ev);
    }
    this.box.on('wheelup', (data: any) => {
      if (data && data.shift) this.hScrollBy(-8);
      else { this.box.scroll(-3); this.box.screen.render(); }
    });
    this.box.on('wheeldown', (data: any) => {
      if (data && data.shift) this.hScrollBy(8);
      else { this.box.scroll(3); this.box.screen.render(); }
    });
  }

  private hScrollBy(delta: number) {
    if (this.wrap || !this.rawLines.length) return;
    const numWidth = String(this.rawLines.length).length;
    const gutter = numWidth + 4; // "  " + number + "  "
    const innerW = ((this.box.width as number) || 80) - 2; // minus borders
    const codeW = Math.max(10, innerW - gutter);
    const max = Math.max(0, this.maxLineWidth - codeW);
    const next = Math.max(0, Math.min(max, this.hScroll + delta));
    if (next === this.hScroll) return;
    this.hScroll = next;
    this.rerender();
    this.onHScrollChange();
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
    if (this.wrap) this.hScroll = 0; // horizontal scroll is moot once wrapping
    // blessed caches the wrapped lines in `_clines`, keyed only by content +
    // width. Flipping the wrap flag with identical content does NOT invalidate
    // that cache, so the toggle silently no-ops until some later interaction
    // (resize, new file) forces a re-parse — the "have to do something else
    // for it to kick in" bug. Drop the cache so the flip applies right away.
    (this.box as any)._clines = null;
    this.rerender();
    this.onWrapChange(this.wrap);
  }

  load(filePath: string, line?: number) {
    this.highlightedLine = line && line > 0 ? line : undefined;
    this.selectionAnchor = undefined;
    this.selectionActive = undefined;
    this.hScroll = 0;

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
          this.maxLineWidth = this.rawLines.reduce((m, l) => Math.max(m, l.length), 0);
          content = this.withLineNumbers(text, this.highlightedLine);
        }
      }
    } catch (e: any) {
      content = `Error reading file: ${e.message}`;
    }

    if (!raw) {
      this.rawText = '';
      this.rawLines = [];
      this.maxLineWidth = 0;
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
    const selBg = selRange ? bgAnsi(this.theme.viewerSelectionBg) : '';
    const selNumFg = selRange ? fgAnsi(this.theme.viewerSelectionFg) : '';
    return lines
      .map((l, i) => {
        const num = String(i + 1).padStart(width, ' ');
        const lineNum = i + 1;
        // Horizontal scroll slides only the code; the gutter stays fixed.
        const code = this.hScroll > 0 ? sliceAnsiLeft(l, this.hScroll) : l;
        if (selRange && lineNum >= selRange[0] && lineNum <= selRange[1]) {
          // Pastel bg persists through cli-highlight's fg toggles (39 only resets fg).
          // We color only the gutter; \x1b[39m before content lets syntax tokens keep
          // their original fg over the selection bg.
          return `${selBg}${selNumFg}  ${num}\x1b[39m  ${code}\x1b[0m`;
        }
        if (hl === lineNum) {
          return `${hlBg}\x1b[33m▸ ${num}\x1b[39m  ${code}\x1b[0m`;
        }
        return `  \x1b[90m${num}\x1b[39m  ${code}`;
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

  applyTheme(theme: Theme) {
    this.theme = theme;
    applyBorderStyle(this.box, theme);
    applyScrollbarStyle(this.box, theme);
    this.rerender();
  }
}

// Drop the first `startCol` visible columns of an ANSI-laden string, keeping
// the syntax-color state that was active at the cut point (so a horizontally
// scrolled line still renders with the right colors).
function sliceAnsiLeft(s: string, startCol: number): string {
  if (startCol <= 0) return s;
  let visible = 0;
  let i = 0;
  let activeAnsi = '';
  while (i < s.length && visible < startCol) {
    if (s[i] === '\x1b') {
      const m = /^\x1b\[[\d;]*m/.exec(s.slice(i));
      if (m) {
        const code = m[0];
        if (code === '\x1b[0m' || code === '\x1b[m') activeAnsi = '';
        else activeAnsi += code;
        i += code.length;
        continue;
      }
    }
    visible++;
    i++;
  }
  return activeAnsi + s.slice(i);
}

function applyBorderStyle(widget: any, theme: Theme) {
  const s = widget.style ?? (widget.style = {});
  s.border = s.border ?? {};
  s.border.fg = theme.borderFg;
  s.focus = s.focus ?? {};
  s.focus.border = s.focus.border ?? {};
  s.focus.border.fg = theme.borderFocusFg;
}

function applyScrollbarStyle(widget: any, theme: Theme) {
  if (widget.scrollbar) {
    widget.scrollbar.style = widget.scrollbar.style ?? {};
    widget.scrollbar.style.bg = theme.scrollbarBg;
    widget.scrollbar.track = widget.scrollbar.track ?? {};
    widget.scrollbar.track.bg = theme.scrollbarTrackBg;
  }
  if (widget.style?.scrollbar) {
    widget.style.scrollbar.bg = theme.scrollbarBg;
    if (widget.style.scrollbar.track) widget.style.scrollbar.track.bg = theme.scrollbarTrackBg;
  }
}

export function applyListThemeStyles(widget: any, theme: Theme) {
  applyBorderStyle(widget, theme);
  applyScrollbarStyle(widget, theme);
  const s = widget.style ?? (widget.style = {});
  s.selected = s.selected ?? {};
  s.selected.bg = theme.selectedBg;
  s.selected.fg = theme.selectedFg;
}
