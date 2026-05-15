# tcode — Development Guidelines

`tcode` is a read-only, VS Code–like code explorer for the terminal, built on
[blessed](https://github.com/chjj/blessed). Source in `src/`, compiled to
`dist/` via `npm run build` (`tsc`).

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

`npm run build` runs `tsc` then `chmod +x dist/index.js`. Always build before
committing and never commit if the build fails.
