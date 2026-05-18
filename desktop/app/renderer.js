// tcode — renderer entry point. Wires the components together and owns the
// global keybindings, splitter drag, theme/wrap toggles and the project-root
// (the "home") navigation.
'use strict';

(function () {
  const path = require('path');
  const fs = require('fs');
  const { spawn } = require('child_process');
  const TC = window.TC;

  // ── Config handed over by the main process via the file:// query string ──
  const params = new URLSearchParams(location.search);
  const startDir = params.get('dir') || process.cwd();
  const initialWrap = params.get('wrap') === 'true';
  const initialTheme = params.get('theme') === 'light' ? 'light' : 'dark';

  TC.theme.apply(initialTheme);

  let fsys = new TC.FileSystem(startDir);
  let rootName = path.basename(fsys.root) || fsys.root;
  document.title = 'tcode — ' + rootName;

  const $ = (id) => document.getElementById(id);
  const workspace = $('workspace');
  const treePane = $('tree-pane');
  const viewerPane = $('viewer-pane');
  const chatPane = $('chat-pane');
  const splitTree = $('split-tree');
  const splitChat = $('split-chat');
  const overlay = $('overlay');

  // ── Components ──
  const tree = new TC.FileTree($('tree-body'), treePane, fsys);
  const viewer = new TC.Viewer($('viewer-body'), viewerPane, { wrap: initialWrap });
  const palette = new TC.CommandPalette($('palette'), fsys);
  const chat = new TC.ClaudeChat(chatPane, fsys.root);
  const git = new TC.GitExplorer($('git'), fsys.root);
  const clone = new TC.CloneModal($('clone'));
  const status = new TC.StatusBar($('statusbar'));

  status.update({ wrap: initialWrap, theme: initialTheme });

  function anyModalOpen() {
    return palette.visible || git.visible || clone.visible;
  }

  // ── Wiring ──
  tree.onOpen = (p) => {
    viewer.load(p);
    viewer.focus();
  };
  tree.onChangeRoot = (p) => setRoot(p, { pull: true });

  viewer.onFileChange = (p) => {
    status.update({ file: p, selection: viewer.selectionRange() });
    document.title = 'tcode — ' + (p ? path.basename(p) : rootName);
  };
  viewer.onSelectionChange = () => status.update({ selection: viewer.selectionRange() });
  viewer.onWrapChange = (w) => status.update({ wrap: w });

  palette.onSelect = (p) => {
    tree.revealFile(p);
    viewer.load(p);
    viewer.focus();
  };
  palette.onShow = () => overlay.classList.remove('hidden');
  palette.onHide = () => {
    overlay.classList.add('hidden');
    viewer.focus();
  };

  chat.onOpenFile = (p, line) => {
    tree.revealFile(p);
    viewer.load(p, line);
    viewer.focus();
  };
  chat.onShow = () => splitChat.classList.remove('hidden');
  chat.onHide = () => {
    splitChat.classList.add('hidden');
    viewer.focus();
  };
  chat.onDefocus = () => viewer.focus();

  git.onOpenFile = (p) => {
    tree.revealFile(p);
    viewer.load(p);
    viewer.focus();
  };
  git.onShow = () => overlay.classList.remove('hidden');
  git.onHide = () => {
    overlay.classList.add('hidden');
    viewer.focus();
  };

  clone.onShow = () => overlay.classList.remove('hidden');
  clone.onHide = () => {
    overlay.classList.add('hidden');
    tree.focus();
  };
  clone.onCloned = (clonedPath) => {
    tree.revealFile(clonedPath); // also rebuilds the tree so the new folder shows
    palette.invalidate();
    status.flash('Cloned ' + path.basename(clonedPath));
  };

  overlay.addEventListener('mousedown', () => {
    if (palette.visible) palette.hide();
    else if (git.visible) git.hide();
    else if (clone.visible) clone.hide();
  });

  // ── Project root ("home") navigation ──

  // Re-root the whole app at `newPath`: every component is scoped to the root.
  function setRoot(newPath, opts) {
    opts = opts || {};
    newPath = path.resolve(newPath);
    try {
      if (!fs.statSync(newPath).isDirectory()) return;
    } catch {
      return;
    }
    if (newPath === fsys.root) return;

    fsys = new TC.FileSystem(newPath);
    rootName = path.basename(fsys.root) || fsys.root;
    tree.setRoot(fsys);
    palette.setRoot(fsys);
    chat.setRoot(fsys.root);
    git.setRoot(fsys.root);
    viewer.reset();
    status.update({ file: null, selection: null });
    document.title = 'tcode — ' + rootName;
    tree.focus();

    if (opts.pull) pullIfRepo(fsys.root);
  }

  // When the new root is a git repo, pull in the background and refresh.
  function pullIfRepo(root) {
    if (!fs.existsSync(path.join(root, '.git'))) return;
    const name = path.basename(root);
    status.flash('Pulling ' + name + '…', 120000);
    let stderr = '';
    let child;
    try {
      child = spawn('git', ['pull', '--ff-only'], { cwd: root });
    } catch {
      return;
    }
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('error', () => status.flash('git not available'));
    child.on('close', (code) => {
      if (fsys.root !== root) return; // root changed again while pulling
      if (code === 0) {
        tree.rebuild();
        palette.invalidate();
        status.flash('Pulled ' + name);
      } else {
        status.flash('Pull failed: ' + (stderr.trim().split('\n').pop() || 'exit ' + code));
      }
    });
  }

  // ── Chat toggle (carries the editor's line selection as context) ──
  function toggleChat() {
    if (chat.visible) {
      chat.hide();
      return;
    }
    const sel = viewer.selectionRange();
    if (sel && viewer.currentFile) {
      chat.show({
        context: { file: viewer.currentFile, range: sel, text: viewer.selectionText() },
      });
    } else {
      chat.show();
    }
  }

  // Tab toggles Explorer ↔ Editor (chat owns Tab while it is focused).
  function switchPane() {
    const ae = document.activeElement;
    if (treePane === ae || treePane.contains(ae)) viewer.focus();
    else tree.focus();
  }

  function toggleTheme() {
    status.update({ theme: TC.theme.toggle() });
  }

  function quit() {
    window.close();
  }

  // ── Global keybindings — capture phase, so component handlers never see a
  //    key that is a global shortcut. ──
  document.addEventListener(
    'keydown',
    (e) => {
      if (anyModalOpen()) return; // an open modal owns the keyboard

      const ae = document.activeElement;
      const typing =
        ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable);
      const inChat = chatPane.contains(ae);
      const take = () => {
        e.preventDefault();
        e.stopPropagation();
      };
      const mod = TC.platform.mod(e);

      if (mod && e.shiftKey && (e.key === 'c' || e.key === 'C')) {
        take();
        clone.show(fsys.root);
        return;
      }
      if (mod && e.key === 'Backspace' && !typing) {
        take();
        setRoot(path.dirname(fsys.root), { pull: true });
        return;
      }
      if (mod && e.key === 'q') { take(); quit(); return; }
      if (mod && e.key === 'p') { take(); palette.show(); return; }
      if (mod && e.key === 'a') { take(); toggleChat(); return; }
      if (mod && e.key === 'g') { take(); git.show(); return; }
      // Leave every other modifier combo alone (copy, reload, the editor's
      // own Cmd/Ctrl+C and Cmd/Ctrl+Enter handlers, …).
      if (e.ctrlKey || e.metaKey) return;

      if (e.key === 'Tab' && !inChat) { take(); switchPane(); return; }

      if (!typing) {
        if (e.key === 'd') { take(); toggleTheme(); return; }
        if (e.key === 'w') { take(); viewer.toggleWrap(); return; }
        if (e.key === 'q' && (ae === treePane || ae === viewerPane)) { take(); quit(); return; }
      }
    },
    true
  );

  // Whenever the window regains focus, put the cursor back on the file tree.
  window.addEventListener('focus', () => {
    if (!anyModalOpen()) tree.focus();
  });

  // ── Splitter drag ──
  const MIN_PANE = 150;

  function setupSplitter(splitter, onDrag) {
    splitter.addEventListener('mousedown', (e) => {
      e.preventDefault();
      document.body.style.cursor = 'col-resize';
      const move = (ev) => onDrag(ev.clientX);
      const up = () => {
        document.body.style.cursor = '';
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
  }

  setupSplitter(splitTree, (x) => {
    const ws = workspace.getBoundingClientRect();
    const chatW = chat.visible ? chatPane.offsetWidth : 0;
    const max = Math.max(MIN_PANE, ws.width - chatW - MIN_PANE - 20);
    treePane.style.width = Math.max(MIN_PANE, Math.min(x - ws.left, max)) + 'px';
  });

  setupSplitter(splitChat, (x) => {
    const ws = workspace.getBoundingClientRect();
    const max = Math.max(220, ws.width - treePane.offsetWidth - MIN_PANE - 20);
    chatPane.style.width = Math.max(220, Math.min(ws.right - x, max)) + 'px';
  });

  // ── Go ──
  tree.focus();
})();
