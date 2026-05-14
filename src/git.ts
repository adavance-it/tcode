import * as blessed from 'blessed';
import { spawnSync } from 'child_process';
import { Theme, bgAnsi } from './theme';

interface Commit {
  sha: string;
  shortSha: string;
  date: string;
  author: string;
  subject: string;
}

export class GitExplorer {
  private screen: blessed.Widgets.Screen;
  private root: string;
  private theme: Theme;
  private container: blessed.Widgets.BoxElement;
  private list: blessed.Widgets.ListElement;
  private diff: blessed.Widgets.BoxElement;
  private hint: blessed.Widgets.BoxElement;
  private commits: Commit[] = [];
  visible = false;
  onShow: () => void = () => {};
  onHide: () => void = () => {};
  onOpenFile: (filePath: string, line?: number) => void = () => {};

  constructor(screen: blessed.Widgets.Screen, root: string, theme: Theme) {
    this.screen = screen;
    this.root = root;
    this.theme = theme;

    this.container = blessed.box({
      parent: screen,
      hidden: true,
      top: 'center',
      left: 'center',
      width: '90%',
      height: '90%',
      border: 'line',
      label: ' Git Explorer ',
      style: { border: { fg: theme.modalBorderFg } },
      tags: false,
    });

    this.list = blessed.list({
      parent: this.container,
      top: 0,
      left: 0,
      width: '40%',
      bottom: 1,
      border: 'line',
      label: ' Commits ',
      keys: true,
      vi: true,
      mouse: true,
      tags: false,
      scrollable: true,
      alwaysScroll: true,
      scrollbar: {
        ch: ' ',
        track: { bg: theme.scrollbarTrackBg },
        style: { bg: theme.scrollbarBg },
      },
      style: {
        selected: { bg: theme.selectedBg, fg: theme.selectedFg },
        border: { fg: theme.borderFg },
        focus: { border: { fg: theme.borderFocusFg } },
      },
    });

    this.diff = blessed.box({
      parent: this.container,
      top: 0,
      left: '40%',
      right: 0,
      bottom: 1,
      border: 'line',
      label: ' Diff ',
      keys: true,
      vi: true,
      mouse: true,
      tags: false,
      scrollable: true,
      alwaysScroll: true,
      scrollbar: {
        ch: ' ',
        track: { bg: theme.scrollbarTrackBg },
        style: { bg: theme.scrollbarBg },
      },
      style: {
        border: { fg: theme.borderFg },
        focus: { border: { fg: theme.borderFocusFg } },
      },
      content: '(select a commit on the left)',
    });

    this.hint = blessed.box({
      parent: this.container,
      bottom: 0,
      left: 1,
      right: 1,
      height: 1,
      tags: false,
      style: { fg: 'gray' },
      content: 'Tab: switch panes  •  Enter: load diff  •  o: open touched file  •  Esc: close',
    });

    this.list.on('select', () => this.loadDiff());
    this.list.key(['enter'], () => this.loadDiff());
    this.list.key(['tab'], () => this.diff.focus());
    this.diff.key(['tab'], () => this.list.focus());
    this.list.key(['escape'], () => this.hide());
    this.diff.key(['escape'], () => this.hide());
    this.list.key(['o'], () => this.openTouchedFile());
  }

  show() {
    this.visible = true;
    this.onShow();
    this.container.show();
    this.loadCommits();
    this.list.focus();
    this.container.setFront();
    this.screen.render();
  }

  hide() {
    if (!this.visible) return;
    this.visible = false;
    this.container.hide();
    this.onHide();
    this.screen.render();
  }

  private loadCommits() {
    const r = spawnSync('git', [
      'log', '--pretty=format:%H|%h|%ad|%an|%s', '--date=short', '-500',
    ], { cwd: this.root, encoding: 'utf8' });
    if (r.status !== 0) {
      this.list.setItems(['(not a git repository, or git failed)']);
      this.commits = [];
      this.diff.setContent(r.stderr || '');
      return;
    }
    this.commits = r.stdout.split('\n').filter(Boolean).map(line => {
      const [sha, shortSha, date, author, ...subj] = line.split('|');
      return { sha, shortSha, date, author, subject: subj.join('|') };
    });
    this.list.setItems(this.commits.map(c =>
      `${c.shortSha}  ${c.date}  ${truncate(c.author, 14)}  ${c.subject}`
    ));
    if (this.commits.length) {
      this.list.select(0);
      this.loadDiff();
    }
  }

  private loadDiff() {
    const idx = (this.list as any).selected as number;
    const c = this.commits[idx];
    if (!c) return;
    const r = spawnSync('git', ['show', '--stat', '--patch', '--color=always', c.sha], {
      cwd: this.root, encoding: 'utf8', maxBuffer: 50 * 1024 * 1024,
    });
    const out = r.status === 0 ? r.stdout : (r.stderr || `git show failed for ${c.sha}`);
    this.diff.setContent(this.colorizeDiff(out));
    this.diff.scrollTo(0);
    this.diff.setLabel(` ${c.shortSha} — ${truncate(c.subject, 60)} `);
    this.screen.render();
  }

  // git already emits ANSI colors with --color=always; just pass through.
  // (kept as a hook in case we want to post-process).
  private colorizeDiff(text: string): string {
    return text;
  }

  // 'o' on a commit: pick the first file path in the patch and open it
  private openTouchedFile() {
    const idx = (this.list as any).selected as number;
    const c = this.commits[idx];
    if (!c) return;
    const r = spawnSync('git', ['show', '--name-only', '--pretty=format:', c.sha], {
      cwd: this.root, encoding: 'utf8',
    });
    if (r.status !== 0) return;
    const files = r.stdout.split('\n').map(s => s.trim()).filter(Boolean);
    if (!files.length) return;
    const abs = require('path').resolve(this.root, files[0]);
    this.hide();
    this.onOpenFile(abs);
  }
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s.padEnd(n, ' ') : s.slice(0, n - 1) + '…';
}
