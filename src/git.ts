import * as blessed from 'blessed';
import { spawnSync } from 'child_process';
import * as path from 'path';
import { Theme } from './theme';
import { applyListThemeStyles } from './viewer';

interface Commit {
  sha: string;
  shortSha: string;
  date: string;
  author: string;
  subject: string;
}

type Mode = 'commits' | 'files';

export class GitExplorer {
  private screen: blessed.Widgets.Screen;
  private root: string;
  private theme: Theme;
  private container: blessed.Widgets.BoxElement;
  private commitsList: blessed.Widgets.ListElement;
  private filesList: blessed.Widgets.ListElement;
  private diff: blessed.Widgets.BoxElement;
  private hint: blessed.Widgets.BoxElement;
  private commits: Commit[] = [];
  private files: string[] = [];
  private selectedCommit?: Commit;
  private mode: Mode = 'commits';
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

    const leftPaneOpts: blessed.Widgets.ListOptions<blessed.Widgets.ListElementStyle> = {
      parent: this.container,
      top: 0,
      left: 0,
      width: '40%',
      bottom: 1,
      border: 'line',
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
    };

    this.commitsList = blessed.list({ ...leftPaneOpts, label: ' Commits ' });
    this.filesList = blessed.list({ ...leftPaneOpts, label: ' Files ', hidden: true });

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
      content: '',
    });

    // commits mode wiring
    this.commitsList.on('select item', () => this.previewCommitStat());
    this.commitsList.on('select', () => this.openCommit());
    this.commitsList.key(['enter'], () => this.openCommit());
    this.commitsList.key(['tab'], () => this.diff.focus());
    this.commitsList.key(['escape'], () => this.hide());
    this.commitsList.key(['o'], () => this.openTouchedFile());

    // files mode wiring
    this.filesList.on('select item', () => this.loadFileDiff());
    this.filesList.on('select', () => this.openSelectedFile());
    this.filesList.key(['enter'], () => this.openSelectedFile());
    this.filesList.key(['tab'], () => this.diff.focus());
    this.filesList.key(['escape'], () => this.backToCommits());

    // diff: tab back to whichever list is active; esc respects current mode
    this.diff.key(['tab'], () => this.activeList().focus());
    this.diff.key(['escape'], () => {
      if (this.mode === 'files') this.backToCommits();
      else this.hide();
    });
  }

  private activeList(): blessed.Widgets.ListElement {
    return this.mode === 'files' ? this.filesList : this.commitsList;
  }

  show() {
    this.mode = 'commits';
    this.filesList.hide();
    this.commitsList.show();
    this.visible = true;
    this.onShow();
    this.container.show();
    this.loadCommits();
    this.commitsList.focus();
    this.refreshHint();
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
      this.commitsList.setItems(['(not a git repository, or git failed)']);
      this.commits = [];
      this.diff.setContent(r.stderr || '');
      return;
    }
    this.commits = r.stdout.split('\n').filter(Boolean).map(line => {
      const [sha, shortSha, date, author, ...subj] = line.split('|');
      return { sha, shortSha, date, author, subject: subj.join('|') };
    });
    this.commitsList.setItems(this.commits.map(c =>
      `${c.shortSha}  ${c.date}  ${truncate(c.author, 14)}  ${c.subject}`
    ));
    if (this.commits.length) {
      (this.commitsList as any).select(0);
      this.previewCommitStat();
    }
  }

  // Cheap preview while arrow-navigating commits — stat only, no full patch.
  private previewCommitStat() {
    if (this.mode !== 'commits') return;
    const idx = (this.commitsList as any).selected as number;
    const c = this.commits[idx];
    if (!c) return;
    const r = spawnSync('git', ['show', '--stat', '--color=always', '--format=%s%n%nAuthor: %an%nDate:   %ad%n%n%b', c.sha], {
      cwd: this.root, encoding: 'utf8', maxBuffer: 5 * 1024 * 1024,
    });
    const out = r.status === 0 ? r.stdout : (r.stderr || `git show failed for ${c.sha}`);
    this.diff.setContent(out);
    this.diff.scrollTo(0);
    this.diff.setLabel(` ${c.shortSha} — ${truncate(c.subject, 60)} `);
    this.screen.render();
  }

  // Enter on a commit: switch to files mode, list files touched, show first diff.
  private openCommit() {
    const idx = (this.commitsList as any).selected as number;
    const c = this.commits[idx];
    if (!c) return;
    this.selectedCommit = c;

    const r = spawnSync('git', ['show', '--name-only', '--pretty=format:', c.sha], {
      cwd: this.root, encoding: 'utf8',
    });
    if (r.status !== 0) {
      this.diff.setContent(r.stderr || `git show failed for ${c.sha}`);
      this.screen.render();
      return;
    }
    this.files = r.stdout.split('\n').map(s => s.trim()).filter(Boolean).sort();
    if (!this.files.length) {
      this.diff.setContent('(no files in this commit)');
      this.screen.render();
      return;
    }

    this.filesList.setItems(this.files);
    (this.filesList as any).select(0);
    this.filesList.setLabel(` ${c.shortSha} — Files (${this.files.length}) `);

    this.mode = 'files';
    this.commitsList.hide();
    this.filesList.show();
    this.filesList.focus();
    this.refreshHint();
    this.loadFileDiff();
    this.screen.render();
  }

  private backToCommits() {
    this.mode = 'commits';
    this.filesList.hide();
    this.commitsList.show();
    this.commitsList.focus();
    this.previewCommitStat();
    this.refreshHint();
    this.screen.render();
  }

  private loadFileDiff() {
    if (this.mode !== 'files') return;
    const c = this.selectedCommit;
    if (!c) return;
    const idx = (this.filesList as any).selected as number;
    const file = this.files[idx];
    if (!file) return;
    const r = spawnSync('git', [
      'show', '--color=always', '--format=', c.sha, '--', file,
    ], { cwd: this.root, encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
    const out = r.status === 0 ? r.stdout : (r.stderr || `git show failed for ${c.sha} -- ${file}`);
    this.diff.setContent(out || '(no diff for this file)');
    this.diff.scrollTo(0);
    this.diff.setLabel(` ${file} @ ${c.shortSha} `);
    this.screen.render();
  }

  private openSelectedFile() {
    const c = this.selectedCommit;
    if (!c) return;
    const idx = (this.filesList as any).selected as number;
    const file = this.files[idx];
    if (!file) return;
    const abs = path.resolve(this.root, file);
    this.hide();
    this.onOpenFile(abs);
  }

  applyTheme(theme: Theme) {
    this.theme = theme;
    const c: any = this.container;
    if (c.style?.border) c.style.border.fg = theme.modalBorderFg;
    applyListThemeStyles(this.commitsList as any, theme);
    applyListThemeStyles(this.filesList as any, theme);
    const d: any = this.diff;
    if (d.style?.border) d.style.border.fg = theme.borderFg;
    if (d.style?.focus?.border) d.style.focus.border.fg = theme.borderFocusFg;
    if (d.scrollbar) {
      d.scrollbar.style = d.scrollbar.style ?? {};
      d.scrollbar.style.bg = theme.scrollbarBg;
      d.scrollbar.track = d.scrollbar.track ?? {};
      d.scrollbar.track.bg = theme.scrollbarTrackBg;
    }
    this.screen.render();
  }

  private refreshHint() {
    if (this.mode === 'commits') {
      this.hint.setContent('Tab: switch panes  •  Enter: open commit files  •  o: open touched file  •  Esc: close');
    } else {
      this.hint.setContent('Tab: switch panes  •  Enter: open file in editor  •  Esc: back to commits');
    }
  }

  // 'o' shortcut on commits list: skip the files view, jump straight to the editor on the first touched file.
  private openTouchedFile() {
    const idx = (this.commitsList as any).selected as number;
    const c = this.commits[idx];
    if (!c) return;
    const r = spawnSync('git', ['show', '--name-only', '--pretty=format:', c.sha], {
      cwd: this.root, encoding: 'utf8',
    });
    if (r.status !== 0) return;
    const files = r.stdout.split('\n').map(s => s.trim()).filter(Boolean);
    if (!files.length) return;
    const abs = path.resolve(this.root, files[0]);
    this.hide();
    this.onOpenFile(abs);
  }
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s.padEnd(n, ' ') : s.slice(0, n - 1) + '…';
}
