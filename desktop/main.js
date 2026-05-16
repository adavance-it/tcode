// tcode-desktop — Electron main process.
//
// Mirrors the terminal `tcode` (src/index.ts): same CLI surface, same start-
// directory resolution, same best-effort background self-update. The window it
// opens loads desktop/app/index.html, which is the desktop port of the whole
// blessed UI (file tree + viewer + Ctrl+P palette + Ctrl+A Claude chat +
// Ctrl+G git explorer).

const { app, BrowserWindow, Menu, nativeTheme, shell } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');

// ─── CLI arg parsing (parity with src/index.ts) ───────────────────────────

// Resolve the directory tcode should operate on. No arg → cwd; `<path>` → that
// path. `~` / `~/...` are expanded. Both forms are equivalent.
function resolveStartDir(arg) {
  if (!arg) return process.cwd();
  let d = arg;
  if (d === '~') d = os.homedir();
  else if (d.startsWith('~/')) d = path.join(os.homedir(), d.slice(2));
  return path.resolve(d);
}

function parseArgs(argv) {
  let dir;
  let wrap = false; // line wrap OFF by default; --wrap enables
  let theme = 'auto';
  for (const a of argv) {
    if (a === '--no-wrap') wrap = false;
    else if (a === '--wrap') wrap = true;
    else if (a === '--dark') theme = 'dark';
    else if (a === '--light') theme = 'light';
    else if (a.startsWith('--theme=')) {
      const v = a.slice('--theme='.length);
      if (v === 'dark' || v === 'light' || v === 'auto') theme = v;
    } else if (a === '-h' || a === '--help') {
      // --help is handled in cli.js before Electron boots; ignore here.
    } else if (!a.startsWith('-')) {
      dir = a;
    }
  }
  return { dir, wrap, theme };
}

// Best-effort self-update: pull the latest tcode in the background so the NEXT
// launch is current. Never blocks or crashes startup. (desktop/ is plain JS so
// no rebuild is needed — a plain `git pull` is enough.)
function selfUpdate() {
  try {
    const repoRoot = path.resolve(__dirname, '..');
    if (!fs.existsSync(path.join(repoRoot, '.git'))) return;
    const child = spawn('sh', ['-c', 'git pull --quiet --ff-only'], {
      cwd: repoRoot,
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  } catch {
    /* updating is never allowed to break the app */
  }
}

// ─── Window ───────────────────────────────────────────────────────────────

let mainWindow = null;

function createWindow(opts) {
  const startTheme =
    opts.theme === 'auto'
      ? nativeTheme.shouldUseDarkColors
        ? 'dark'
        : 'light'
      : opts.theme;

  mainWindow = new BrowserWindow({
    width: 1500,
    height: 950,
    minWidth: 720,
    minHeight: 420,
    title: 'tcode',
    backgroundColor: startTheme === 'light' ? '#ffffff' : '#1e222a',
    autoHideMenuBar: true,
    webPreferences: {
      // tcode-desktop is a local, single-user developer tool that loads only
      // its own bundled files (no remote content) and already shells out to
      // `git` and `claude`. Full Node access in the renderer keeps the port a
      // near-direct translation of the blessed app and avoids an IPC layer.
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'app', 'index.html'), {
    query: {
      dir: opts.startDir,
      wrap: String(opts.wrap),
      theme: startTheme,
    },
  });

  // Open real external links in the OS browser, never inside the app window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Minimal menu: hidden by default (autoHideMenuBar), but kept so the standard
// edit-role accelerators (copy/paste/select-all) and devtools work — macOS in
// particular needs the Edit menu roles for clipboard shortcuts in inputs.
function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [isMac ? { role: 'close' } : { role: 'quit' }],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ─── Boot ─────────────────────────────────────────────────────────────────

// argv: [electron, main.js, ...userArgs]  (or [tcode-desktop, ...userArgs]
// when packaged). app.isPackaged decides where the user args start.
const userArgs = process.argv.slice(app.isPackaged ? 1 : 2);
const parsed = parseArgs(userArgs);
const startDir = resolveStartDir(parsed.dir);

// Validate the start directory up front, same as src/index.ts.
let dirOk = true;
try {
  if (!fs.statSync(startDir).isDirectory()) dirOk = false;
} catch {
  dirOk = false;
}
if (!dirOk) {
  process.stderr.write(`tcode: no such directory: ${startDir}\n`);
  app.quit();
  process.exit(1);
}

app.whenReady().then(() => {
  buildMenu();
  selfUpdate();
  createWindow({ startDir, wrap: parsed.wrap, theme: parsed.theme });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow({ startDir, wrap: parsed.wrap, theme: parsed.theme });
    }
  });
});

app.on('window-all-closed', () => {
  app.quit();
});
