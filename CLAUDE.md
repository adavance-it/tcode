# tcode — Development Guidelines

`tcode` is a read-only, VS Code–like code explorer: a desktop app built on
[Electron](https://www.electronjs.org/). Plain JS, no build step.

## Architecture

- `desktop/cli.js` — the `tcode` console launcher. Boots Electron **detached**
  from the terminal (so closing the terminal doesn't kill the window),
  forwards CLI args, and handles `tcode update` / `--help` itself.
- `desktop/main.js` — Electron main process. Parses args, resolves the start
  directory (or shows a folder picker when launched as a packaged `.app` with
  no argument, remembering the last folder), opens the window, runs a
  best-effort background self-update.
- `desktop/app/` — the renderer. Plain `<script>` tags in `index.html`, no
  bundler. Modules attach to `window.TC`. npm packages (`highlight.js`,
  `fuse.js`, `ignore`) are pulled in with `require()`.
  - `lib/` — platform, theme, langs, files, highlighter, markdown.
  - `components/` — filetree, viewer, palette, chat, gitexplorer, clone,
    statusbar. Each owns its own DOM + behaviour; `renderer.js` instantiates
    them and wires the callbacks + global keybindings.

## Renderer runs with full Node access

The window uses `nodeIntegration: true`, `contextIsolation: false`. This is
deliberate: tcode is a local single-user dev tool that loads only its own
bundled files (no remote content) and already shells out to `git` and
`claude`. **Do not load remote content into the window.**

## No build step

The app is plain JS — run it with `npm start` (or `./run-desktop.sh`). There is
nothing to compile; edit and relaunch. Do not add a bundler / transpile step
without a concrete reason.

## Keybindings

Shortcuts use the OS-primary modifier — Cmd on macOS, Ctrl elsewhere — via
`TC.platform.mod(e)` / `TC.platform.combo()`. Never hardcode `ctrlKey`. Global
shortcuts are handled in `renderer.js` (capture-phase keydown); each component
handles its own keys on its own elements.

## Project root ("home")

tcode operates on a single root directory. `renderer.js` owns `setRoot()`,
which builds a fresh `FileSystem` and re-scopes every component (tree, palette,
chat, git) at the new directory. Triggers: `⌘Enter` / `⌘`+double-click on a
folder (`FileTree.onChangeRoot`), `⌥Enter` for a quick-pick of the folders at
the selected item's level (`components/folderpick.js`), `⌘Backspace` to the
parent. Re-rooting into a git repo runs `git pull --ff-only` in the background
(`pullIfRepo`). `⌘⇧C` opens the clone dialog (`components/clone.js`), which
always clones over SSH so it uses the user's personal key.

## Packaging the macOS app

- `npm run package:mac` runs `electron-builder` (config in the `build` key of
  `package.json`) and emits a `.dmg` + `.zip` into `dist-desktop/`. Must run on
  macOS. `npm run package:mac:dir` emits just the unpacked `.app`.
- `electron` and `electron-builder` are **devDependencies** — electron-builder
  refuses to package when `electron` is a regular dependency. The `tcode` CLI
  still works because `install.sh` / `run-desktop.sh` do a full `npm install`.
- App icon: `build/icon.png` (1024×1024, rendered from `build/icon.svg` with
  `rsvg-convert`).
- `highlight.js/styles/**` is in `asarUnpack` so the theme stylesheet loads
  from a real file path, not from inside the asar archive.

## Verifying

There is no test suite. Verify changes by running the app (`npm start`), or
headlessly with `xvfb-run electron --no-sandbox desktop/main.js <dir>`. Always
confirm the app boots with no renderer errors before committing.
