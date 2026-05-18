# tcode

A read-only, VS Code–like code explorer. Browse a repo with a file tree on the
left and a syntax-highlighted viewer on the right. Fuzzy-search files, ask
Claude about the codebase, walk a git log and inspect diffs.

It ships in two editions, same features, same shortcuts:

- **`tcode`** — the terminal (TUI) edition, built on [blessed](https://github.com/chjj/blessed).
- **`tcode-desktop`** — the desktop edition, an [Electron](https://www.electronjs.org/)
  window. Launch it straight from the console with `tcode-desktop`.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/adavance-it/tcode/main/install.sh | bash
```

The installer clones the repo to `~/dev/tcode`, builds it, and links
`tcode` on your `PATH`. It's idempotent: re-running updates an existing
checkout. Override the destination with `TCODE_DIR=/somewhere/else`.

Once installed, update in place with:

```bash
tcode update
```

`tcode update` just re-runs the install one-liner above (pull + build +
link). tcode also kicks off a background `git pull` + rebuild on every
launch, so it stays current on its own — `tcode update` is the explicit,
synchronous way to do it now.

Alternative one-liner via npm (uses the package's `prepare` script):

```bash
npm install -g github:adavance-it/tcode
```

Requirements: `git`, `node` ≥ 18, `npm`. Claude integration also expects the
[Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI on `PATH`.

## Usage

```bash
tcode                    # browse the current directory
tcode ~/dev/myrepo       # browse a specific directory
tcode --no-wrap repo/    # start with line wrap off
tcode --light            # force light theme (default: auto via $COLORFGBG)
tcode update             # reinstall from the latest main
tcode --help             # full options list
```

## Desktop app

The desktop edition is the same explorer in an Electron window — launched
directly from the console, exactly like the terminal one:

```bash
tcode-desktop                 # browse the current directory
tcode-desktop ~/dev/myrepo    # browse a specific directory
tcode-desktop --wrap repo/    # start with line wrap on
tcode-desktop --light         # force light theme (default: auto, follows the OS)
tcode-desktop update          # reinstall from the latest main
tcode-desktop --help          # full options list
```

Every feature of the terminal edition is replicated: the gitignore-aware file
tree, the syntax-highlighted viewer with line selection, fuzzy search, the
Claude chat (answer streams in token-by-token) with clickable file refs, the
git explorer, dark/light themes and drag-to-resize splitters.

The shortcuts below apply to both editions, with two desktop differences:

- On **macOS** the modifier is **⌘** (`⌘P`, `⌘A`, `⌘G`, `⌘Q`…); on Linux /
  Windows it stays **Ctrl**.
- `⌘`/`Ctrl+C` copies the selected lines, and quit is `⌘`/`Ctrl+Q` — so the
  OS copy shortcut is never shadowed.

`npm run desktop` runs it from a checkout without installing.

### Install it as a macOS app

To get a real `tcode.app` you can drop in **Applications** (Dock icon and
all), build it on a Mac from a checkout:

```bash
npm install
npm run package:mac      # → dist-desktop/tcode-<version>-<arch>.dmg + .zip
```

Open the `.dmg` and drag **tcode** to Applications. Launched from Finder the
app has no path argument, so it opens a folder picker (it remembers the last
folder you opened). The `tcode-desktop` terminal command keeps working
alongside the app.

The build is unsigned, so the first launch needs a right-click → **Open** (or
`xattr -dr com.apple.quarantine /Applications/tcode.app`). `npm run
package:mac:dir` produces just the unpacked `.app` without the installer.

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
| `q`             | Quit (`Ctrl+C` in `tcode`, `Ctrl+Q` in `tcode-desktop`) |

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

Press `Ctrl+A` and type a question. tcode runs `claude -p <prompt>` in the
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
git clone https://github.com/adavance-it/tcode.git
cd tcode
npm install
npm run build       # tsc + chmod +x dist/index.js  (terminal edition)
npm link            # global symlinks for `tcode` and `tcode-desktop`
npm run dev         # tsx-driven run of the terminal edition
npm run desktop     # run the desktop edition without installing
```

Source layout:

```
src/                # terminal edition (TypeScript → dist/ via tsc)
  index.ts      # CLI arg parsing, entry point
  app.ts        # screen orchestration, splitter, key bindings
  filetree.ts   # left panel
  viewer.ts     # right panel with syntax highlighting + selection
  palette.ts    # Ctrl+P fuzzy search modal
  claude.ts     # Ctrl+A chat modal
  git.ts        # Ctrl+G git explorer modal
  files.ts      # filesystem walker (.gitignore aware)
  theme.ts      # dark/light themes + auto-detection

desktop/            # desktop edition (Electron, plain JS — no build step)
  main.js       # Electron main process: window, CLI args, self-update
  cli.js        # `tcode-desktop` console launcher
  app/
    index.html  # window shell
    styles.css  # dark / light theme tokens + layout
    renderer.js # orchestration, global keys, splitters
    lib/        # files / theme / langs / highlighter / markdown
    components/ # filetree, viewer, palette, chat, gitexplorer, statusbar
```

The desktop edition is a straight port of the terminal one — each
`desktop/app/components/*.js` mirrors the matching `src/*.ts`. It is plain JS
(no compile step): `tcode-desktop` boots Electron, which loads
`desktop/app/index.html` directly.

## License

MIT
