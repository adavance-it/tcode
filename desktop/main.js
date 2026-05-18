// tcode-desktop — Electron main process.
//
// Mirrors the terminal `tcode` (src/index.ts): same CLI surface, same start-
// directory resolution, same best-effort background self-update. The window it
// opens loads desktop/app/index.html, the desktop port of the whole UI.
//
// Two launch paths:
//   • as a command — `tcode-desktop [path]` (desktop/cli.js) — takes a path arg.
//   • as a packaged macOS .app — launched from Finder with no arguments, so it
//     opens a folder picker (remembering the last folder).

const { app, BrowserWindow, Menu, nativeTheme, shell, dialog } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');

app.setName('tcode');

// ─── CLI arg parsing (parity with src/index.ts) ───────────────────────────

function resolveStartDir(arg) {
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
    } else if (!a.startsWith('-')) {
      dir = a;
    }
  }
  return { dir, wrap, theme };
}

// Best-effort self-update: pull the latest tcode in the background so the NEXT
// launch is current. No-ops in a packaged app (no .git). Never blocks.
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

// ─── Last-folder memory (for the Finder-launch folder picker) ──────────────

function lastFolderFile() {
  return path.join(app.getPath('userData'), 'last-folder.txt');
}

function readLastFolder() {
  try {
    const p = fs.readFileSync(lastFolderFile(), 'utf8').trim();
    if (p && fs.statSync(p).isDirectory()) return p;
  } catch {
    /* none yet */
  }
  return null;
}

function saveLastFolder(dir) {
  try {
    fs.writeFileSync(lastFolderFile(), dir);
  } catch {
    /* non-fatal */
  }
}

// Decide which directory to open:
//   1. an explicit path argument always wins;
//   2. a packaged app with no argument (Finder launch) asks via a dialog;
//   3. a dev launch with no argument uses the current working directory.
async function resolveStartDirInteractive(parsed) {
  if (parsed.dir) return resolveStartDir(parsed.dir);
  if (app.isPackaged) {
    const res = await dialog.showOpenDialog({
      title: 'Open a folder in tcode',
      buttonLabel: 'Open',
      defaultPath: readLastFolder() || app.getPath('home'),
      properties: ['openDirectory', 'createDirectory'],
    });
    if (res.canceled || !res.filePaths.length) return null;
    return res.filePaths[0];
  }
  return process.cwd();
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

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Minimal menu: hidden by default, but kept so the standard edit-role
// accelerators (copy/paste/select-all) and devtools work — macOS in particular
// needs the Edit menu roles for clipboard shortcuts in inputs.
function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { label: 'File', submenu: [isMac ? { role: 'close' } : { role: 'quit' }] },
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

// argv: [electron, main.js, ...userArgs] in dev; [tcode, ...userArgs] packaged.
const userArgs = process.argv.slice(app.isPackaged ? 1 : 2);
const parsed = parseArgs(userArgs);

app.whenReady().then(async () => {
  buildMenu();

  const dir = await resolveStartDirInteractive(parsed);
  if (dir === null) {
    // User dismissed the folder picker — nothing to open.
    app.quit();
    return;
  }

  let dirOk = true;
  try {
    if (!fs.statSync(dir).isDirectory()) dirOk = false;
  } catch {
    dirOk = false;
  }
  if (!dirOk) {
    dialog.showErrorBox('tcode', `Not a directory:\n${dir}`);
    app.quit();
    return;
  }

  saveLastFolder(dir);
  selfUpdate();
  createWindow({ startDir: dir, wrap: parsed.wrap, theme: parsed.theme });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow({ startDir: dir, wrap: parsed.wrap, theme: parsed.theme });
    }
  });
});

app.on('window-all-closed', () => {
  app.quit();
});
