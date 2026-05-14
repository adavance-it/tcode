# tercode

A read-only, VS Code–like code explorer that lives in your terminal.

Browse a repo with a file tree on the left and a syntax-highlighted viewer on
the right. Fuzzy-search files, ask Claude about the codebase, walk a git log
and inspect diffs — all without leaving the terminal.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/josematiasrivero/tercode/main/install.sh | bash
```

The installer clones the repo to `~/dev/tercode`, builds it, and links
`tercode` on your `PATH`. It's idempotent: re-running updates an existing
checkout. Override the destination with `TERCODE_DIR=/somewhere/else`.

Alternative one-liner via npm (uses the package's `prepare` script):

```bash
npm install -g github:josematiasrivero/tercode
```

Requirements: `git`, `node` ≥ 18, `npm`. Claude integration also expects the
[Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI on `PATH`.

## Usage

```bash
tercode                    # browse the current directory
tercode ~/dev/myrepo       # browse a specific directory
tercode --no-wrap repo/    # start with line wrap off
tercode --light            # force light theme (default: auto via $COLORFGBG)
tercode --help             # full options list
```

## Shortcuts

### Navigation

| Key             | Action                                       |
| --------------- | -------------------------------------------- |
| `Tab`           | Switch focus between Explorer and Editor     |
| `↑` / `↓` / `j` / `k` | Move cursor                            |
| `Enter`         | Open file / toggle directory                 |
| `←` / `→` / `h` / `l` | Collapse / expand directory or jump to parent |
| `g` / `G`       | Top / bottom of file                         |
| `PgUp` / `PgDn` | Half-page scroll in editor                   |
| `q` / `Ctrl+C`  | Quit                                         |

### Modals

| Key       | Action                                                 |
| --------- | ------------------------------------------------------ |
| `Ctrl+P`  | Fuzzy file search                                      |
| `Ctrl+A`  | Ask Claude about the codebase (uses selection as context) |
| `Ctrl+G`  | Git explorer (commit log + diff)                       |
| `Ctrl+N`  | (inside Claude chat) Start a new conversation          |
| `Esc`     | Close modal / clear selection                          |

### Editor

| Key             | Action                                       |
| --------------- | -------------------------------------------- |
| `Shift+↑/↓`     | Extend line selection                        |
| `Shift+J/K`     | Extend line selection (vim-style)            |
| Click           | Set selection anchor                         |
| `Shift+click`   | Extend selection to clicked line             |
| `w`             | Toggle line wrap                             |

### Layout

Drag the column between the panes with the mouse to resize them.

## Claude integration

Press `Ctrl+A` and type a question. tercode runs `claude -p <prompt>` in the
project directory. The answer is parsed for file references shaped like
`path/to/file.ts:42`; those become a navigable list in the bottom of the
modal. Pressing `Enter` on a reference opens the file at that line, and the
referenced line is visually highlighted in the editor.

The conversation persists across `Ctrl+A` opens, so you can jump to a file,
read it, then `Ctrl+A` again to return to the same answer. `Ctrl+N` starts a
new question.

If there's an active selection in the editor when you press `Ctrl+A`, those
lines are sent as context with your question.

## Git explorer

`Ctrl+G` opens a two-pane modal: a list of recent commits on the left, the
diff for the selected commit on the right. Press `Enter` on a commit to load
its diff, `o` to jump to the first file touched by that commit, `Tab` to move
focus between the panes, `Esc` to close.

## Theme

Auto-detected via `COLORFGBG` (used by most modern terminals). Force with
`--theme=dark` / `--theme=light` (or `--dark` / `--light`).

## Development

```bash
git clone https://github.com/josematiasrivero/tercode.git
cd tercode
npm install
npm run build       # tsc + chmod +x dist/index.js
npm link            # global symlink for the `tercode` binary
npm run dev         # tsx-driven run without prebuilding
```

Source layout:

```
src/
  index.ts      # CLI arg parsing, entry point
  app.ts        # screen orchestration, splitter, key bindings
  filetree.ts   # left panel
  viewer.ts    # right panel with syntax highlighting + selection
  palette.ts    # Ctrl+P fuzzy search modal
  claude.ts     # Ctrl+A chat modal
  git.ts        # Ctrl+G git explorer modal
  files.ts      # filesystem walker (.gitignore aware)
  theme.ts      # dark/light themes + auto-detection
```

## License

MIT
