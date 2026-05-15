// Shared mouse behaviour for blessed list widgets.
//
// tcode UI principle (see CLAUDE.md): the mouse WHEEL scrolls the viewport
// ONLY — it never moves the selection cursor. The selection moves on keyboard
// navigation, or on an explicit click. A click selects the clicked row *in
// place* without scrolling the viewport (the row is already visible, so there
// is nothing to scroll). blessed's defaults violate both rules, so every list
// in the app routes its mouse handling through these helpers.

function visibleRows(list: any): number {
  const h = (list.height as number) || 20;
  return Math.max(1, h - 2); // minus top/bottom border
}

// Wheel scrolls the viewport (childBase) without touching `selected`.
export function wheelScrollsViewportOnly(list: any): void {
  for (const ev of ['wheelup', 'wheeldown', 'element wheelup', 'element wheeldown']) {
    list.removeAllListeners(ev);
  }
  const scroll = (delta: number) => {
    const visible = visibleRows(list);
    const count = list.items?.length ?? 0;
    const max = Math.max(0, count - visible);
    const oldBase = list.childBase ?? 0;
    const newBase = Math.max(0, Math.min(max, oldBase + delta));
    if (newBase === oldBase) return;
    list.childBase = newBase;
    // Keep the cursor pinned to its absolute index; only its on-screen offset
    // shifts. If it scrolls out of view the highlight just disappears until
    // the user scrolls back or moves with the keyboard.
    list.childOffset = (list.selected ?? 0) - newBase;
    list.screen.render();
  };
  list.on('element wheelup', () => scroll(-3));
  list.on('element wheeldown', () => scroll(3));
}

// Replaces blessed's default item-click handler (which calls select() and can
// scroll the viewport) with one that selects the clicked row in place and
// invokes onClick(index). childBase is left untouched.
export function clickSelectsInPlace(list: any, onClick: (index: number) => void): void {
  list.removeAllListeners('element click');
  list.on('element click', (el: any) => {
    const idx: number = list.items?.indexOf(el) ?? -1;
    if (idx < 0) return;
    const base = list.childBase ?? 0;
    list.selected = idx;
    list.childOffset = idx - base;
    list.screen.render();
    onClick(idx);
  });
}
