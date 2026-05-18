# tcode

A read-only, VS Code–like code explorer — a desktop app built on
[Electron](https://www.electronjs.org/).

Browse a repo with a file tree on the left and a syntax-highlighted viewer on
the right. Fuzzy-search files, ask Claude about the codebase (answers stream in
token-by-token), walk a git log and inspect diffs. Jump between projects
without leaving the window: open any folder as the root, clone a repo, or step
up to the parent.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/adavance-it/tcode/main/install.sh | bash
```

The installer clones the repo to `~/dev/tcode`, installs dependencies
(downloads Electron the first time) and links `tcode` on your `PATH`. It's
idempotent — re-running updates an existing checkout. Override the destination
with `TCODE_DIR=/somewhere/else`.

Update in place with `tcode update` (re-runs the install one-liner). tcode also
kicks off a background `git pull` on every launch, so it stays current on its
own.

Requirements: `git`, `node` ≥ 18, `npm`. The Claude chat additionally expects
the [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI on
`PATH`.

## Usage

```bash
tcode                    # open the current directory in a window
tcode ~/dev/myrepo       # open a specific directory
tcode --wrap repo/       # start with line wrap on
tcode --light            # force light theme (default: auto, follows the OS)
tcode update             # reinstall from the latest main
tcode --help             # full options list
```

Launched from a terminal, `tcode` detaches from it — close the terminal and the
window keeps running.

## Install it as a macOS app

To get a real `tcode.app` you can drop in **Applications** (Dock icon and
all), build it on a Mac from a checkout:

```bash
cd ~/dev/tcode
npm install
npm run package:mac      # → dist-desktop/tcode-<version>-<arch>.dmg + .zip
```

Open the `.dmg` and drag **tcode** to Applications. Launched from Finder the
app has no path argument, so it opens a folder picker (it remembers the last
folder you opened). The build is unsigned, so the first launch needs a
right-click → **Open** (or `xattr -dr com.apple.quarantine
/Applications/tcode.app`).

## Shortcuts

The modifier is **⌘** on macOS and **Ctrl** on Linux / Windows — written `⌘`
below.

### Navigation

| Key             | Action                                       |
| --------------- | -------------------------------------------- |
| `Tab`           | Switch focus between Explorer and Editor     |
| `↑` `↓` `j` `k` | Move cursor / scroll                         |
| `Enter`         | Open file / toggle directory                 |
| `←` `→` `h` `l` | Collapse / expand directory or jump to parent |
| `g` / `G`       | Top / bottom of file                         |
| `PgUp` `PgDn`   | Half-page scroll in the editor               |
| `⌘Q`            | Quit                                         |

### Project root ("home")

| Key                          | Action                                          |
| ----------------------------- | ----------------------------------------------- |
| `⌘Enter` / `⌘`+double-click   | Open the selected folder as the project root    |
| `⌘Backspace`                  | Step up to the parent folder                    |
| `⌘⇧C`                         | Clone a GitHub repo into the current folder     |

Re-rooting into a git repository runs `git pull --ff-only` in the background.

### Modals & panels

| Key       | Action                                                    |
| --------- | --------------------------------------------------------- |
| `⌘P`      | Fuzzy file search                                         |
| `⌘A`      | Toggle the Claude side panel (uses the selection as context) |
| `⌘G`      | Git explorer (commit log + diff)                          |
| `⌘N`      | (inside Claude chat) start a new conversation             |
| `Esc`     | Close modal / clear selection                             |

### Editor

| Key             | Action                                       |
| --------------- | -------------------------------------------- |
| Click / drag    | Select a line / a block of lines             |
| `Shift+↑/↓`     | Extend the line selection                    |
| `⌘C`            | Copy the selected lines                      |
| `w`             | Toggle line wrap                             |
| `d`             | Toggle dark / light theme                    |

Drag the column between panes with the mouse to resize them.

## Project navigation

tcode always works on a single root directory — the "home". Beyond launching
with a path, you change it from inside the window:

- **`⌘Enter`** on a folder in the Explorer (or **`⌘`+double-click** it) makes
  that folder the new root. The whole app — tree, search, git, Claude — re-scopes
  to it.
- **`⌘Backspace`** steps the root up to the parent folder.
- Whenever you re-root into a git repository, tcode pulls the latest in the
  background and refreshes the tree.

## Cloning repos

`⌘⇧C` opens a small dialog. Type a GitHub `owner/repo` (or a full git URL) and
tcode runs `git clone` into the current root folder, then reveals the new
checkout in the tree.

## Claude integration

Press `⌘A` and type a question. tcode runs `claude -p` in the project directory
with streaming output, so the answer renders token-by-token. File references
shaped like `path/to/file.ts:42` become clickable links — in the answer and in
the Refs list — that jump the editor to that exact line and highlight it.

The conversation persists across `⌘A` toggles; `⌘N` starts a new one. If there
is an active line selection in the editor when you press `⌘A`, those lines are
sent as context.

## Git explorer

`⌘G` opens a two-pane modal: recent commits on the left, the diff on the right.
A synthetic "Uncommitted changes" entry shows the working tree. `Enter` on a
commit lists its files; `Enter` on a file opens it in the editor; `o` jumps
straight to the first file touched; `Tab` moves between panes; `Esc` closes.

## Theme

Auto-detected from the OS at launch; force with `--theme=dark` / `--theme=light`
(or `--dark` / `--light`). Toggle live with `d`.

## Development

```bash
git clone https://github.com/adavance-it/tcode.git
cd tcode
npm install
npm start            # run the app (electron desktop/main.js)
./run-desktop.sh     # run from a checkout, installing deps on first run
npm run package:mac  # build the macOS .app/.dmg (on macOS)
```

The app is plain JS — no build step. `desktop/cli.js` boots Electron, which
loads `desktop/app/index.html`.

```
desktop/
  main.js       # Electron main: window, CLI args, folder picker, self-update
  cli.js        # `tcode` console launcher
  app/
    index.html  # window shell
    styles.css  # dark / light theme tokens + layout
    renderer.js # orchestration, global keys, splitters, root navigation
    lib/        # platform, theme, langs, files, highlighter, markdown
    components/ # filetree, viewer, palette, chat, gitexplorer, clone, statusbar
build/
  icon.svg / icon.png   # macOS app icon
```

## License

MIT
