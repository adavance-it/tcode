// Platform helper — the primary modifier key is Cmd (⌘) on macOS and Ctrl
// everywhere else, so the desktop edition feels native on each OS.
'use strict';

(function () {
  const TC = (window.TC = window.TC || {});

  const isMac =
    typeof process !== 'undefined' && process.platform === 'darwin';

  TC.platform = {
    isMac,
    // True when the OS-primary modifier is held for this event.
    mod(e) {
      return isMac ? e.metaKey : e.ctrlKey;
    },
    // True for any modifier we don't own (so it can pass through to the OS:
    // copy, reload, …). On mac that's Cmd; elsewhere Ctrl.
    otherMod(e) {
      return isMac ? e.metaKey : e.ctrlKey;
    },
    // Short label for the modifier, e.g. "⌘" or "Ctrl".
    label: isMac ? '⌘' : 'Ctrl',
    // A full combo string: "⌘P" on mac, "Ctrl+P" elsewhere.
    combo(key) {
      return isMac ? '⌘' + key : 'Ctrl+' + key;
    },
  };
})();
