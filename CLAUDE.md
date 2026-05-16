# tcode — Development Guidelines

`tcode` is a read-only, VS Code–like code explorer. It ships in two editions:

- **Terminal edition** — `src/` (TypeScript), built on
  [blessed](https://github.com/chjj/blessed), compiled to `dist/` via
  `npm run build` (`tsc`). Binary: `tcode`.
- **Desktop edition** — `desktop/` (plain JS), an [Electron](https://www.electronjs.org/)
  app. No build step. Binary: `tcode-desktop`.

The two editions are kept feature-equivalent: anything added to one should be
ported to the other. The desktop components in `desktop/app/components/*.js`
mirror `src/*.ts` one-to-one.

## Desktop edition

- **No build step.** `desktop/main.js` (Electron main) and the renderer under
  `desktop/app/` are plain JS loaded directly. `tcode-desktop` (the `cli.js`
  launcher) boots Electron on `main.js`.
- **The renderer runs with `nodeIntegration: true`, `contextIsolation: false`.**
  This is deliberate: tcode-desktop is a local single-user dev tool that loads
  only its own files (no remote content) and already shells out to `git` /
  `claude`. Full Node access keeps the port a near-direct translation of the
  blessed app. Do not load remote content into the window.
- **Renderer modules attach to `window.TC`** and are wired with plain
  `<script>` tags in `index.html` (no bundler). npm packages
  (`highlight.js`, `fuse.js`, `ignore`) are pulled in with `require()`.
- **`electron` is a runtime `dependency`**, not a devDependency, so
  `tcode-desktop` works regardless of how the package was installed.
- The mouse-wheel rule below is satisfied for free in the desktop edition —
  native overflow scrolling never moves a selection.

## UI principle: the mouse wheel never moves the selection

This is a hard, app-wide rule for every list / scrollable widget:

- **Mouse wheel** scrolls the *viewport only*. It must NEVER move the
  selection cursor.
- **Selection** moves on **keyboard navigation** or an **explicit click**.
- A **click** selects the clicked row *in place* — it must NOT scroll the
  viewport. The clicked row is already visible, so there is nothing to
  scroll; blessed's default `select()` does a relative scroll that overshoots
  and visibly jumps the list, which is exactly what we forbid.
- **Keyboard navigation** moves the cursor and the viewport follows it as
  needed (this is the one case where a scroll on selection-change is wanted).

blessed's defaults violate all of this, so do not wire list widgets directly.
Route every list through `src/listmouse.ts`:

- `wheelScrollsViewportOnly(list)` — wheel scrolls `childBase`, leaves
  `selected` untouched.
- `clickSelectsInPlace(list, onClick)` — replaces blessed's item-click
  handler with one that sets `selected` in place (no scroll) and calls
  `onClick(index)`.

Currently applied to: the file tree (`filetree.ts`), the git commit and file
lists (`git.ts`), the Ctrl+P palette (`palette.ts`), and the chat refs list
(`claude.ts`). Any new list widget MUST use these helpers too.

## Start directory

`tcode` operates on a single root directory. `tcode` (no argument) uses the
current working directory; `tcode <path>` uses that path — the two are
equivalent. The file tree, Ctrl+P search, git explorer and Claude chat are all
scoped to this root. Resolution lives in `index.ts` (`resolveStartDir`).

## Self-update

On startup `index.ts` spawns a detached background `git pull --ff-only &&
npm run build` in tcode's own repo (best-effort, never blocks). The update
takes effect on the *next* launch.

## Build

`npm run build` runs `tsc` then `chmod +x dist/index.js` (terminal edition).
Always build before committing and never commit if the build fails. The
desktop edition has no build step — verify it with `npm run desktop`, or
headlessly with `xvfb-run electron --no-sandbox desktop/main.js <dir>`.
