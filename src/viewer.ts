import * as blessed from 'blessed';
import * as fs from 'fs';
import * as path from 'path';
import { highlight, supportsLanguage } from 'cli-highlight';

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

export class Viewer {
  box: blessed.Widgets.BoxElement;
  currentFile: string | null = null;
  onFileChange: (filePath: string | null) => void = () => {};

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
    '     q / Ctrl+C    quit',
    '',
  ].join('\n');

  constructor(screen: blessed.Widgets.Screen) {
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
      scrollbar: {
        ch: ' ',
        track: { bg: 'gray' },
        style: { bg: 'cyan' },
      },
      style: {
        focus: { border: { fg: 'cyan' } },
        border: { fg: 'gray' },
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
  }

  load(filePath: string, line?: number) {
    let content: string;
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
          let text = buf.toString('utf8');
          const lang = detectLanguage(filePath);
          if (lang && supportsLanguage(lang)) {
            try {
              text = highlight(text, { language: lang, ignoreIllegals: true });
            } catch {
              /* fall back to plain text */
            }
          }
          content = this.withLineNumbers(text);
        }
      }
    } catch (e: any) {
      content = `Error reading file: ${e.message}`;
    }

    this.currentFile = filePath;
    this.box.setLabel(' ' + path.basename(filePath) + ' ');
    this.box.setContent(content);
    this.box.scrollTo(0);
    if (line && line > 1) this.scrollToLine(line);
    this.onFileChange(filePath);
    this.box.screen.render();
  }

  private withLineNumbers(content: string): string {
    const lines = content.split('\n');
    const width = String(lines.length).length;
    return lines
      .map((l, i) => {
        const num = String(i + 1).padStart(width, ' ');
        return `\x1b[90m${num}\x1b[0m  ${l}`;
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
