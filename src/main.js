const { app, BrowserWindow, ipcMain, shell, net } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { spawn } = require('node:child_process');
const extract = require('extract-zip');
const { autoUpdater } = require('electron-updater');

const MANIFEST_URL =
  'https://raw.githubusercontent.com/VeldboomStudios/veldboom-launcher/main/games.json';

let win = null;

const gamesDir = () => path.join(app.getPath('userData'), 'games');
const installedFile = () => path.join(app.getPath('userData'), 'installed.json');

function readInstalled() {
  try {
    return JSON.parse(fs.readFileSync(installedFile(), 'utf8'));
  } catch {
    return {};
  }
}

function writeInstalled(data) {
  fs.mkdirSync(path.dirname(installedFile()), { recursive: true });
  fs.writeFileSync(installedFile(), JSON.stringify(data, null, 2));
}

async function ghFetch(url) {
  const res = await net.fetch(url, {
    headers: {
      'User-Agent': 'VeldboomLauncher',
      Accept: 'application/vnd.github+json',
    },
  });
  return res;
}

async function latestRelease(repo) {
  try {
    const res = await ghFetch(`https://api.github.com/repos/${repo}/releases/latest`);
    if (!res.ok) return null;
    const rel = await res.json();
    const asset = (rel.assets || []).find((a) => a.name.toLowerCase().endsWith('.zip'));
    if (!asset) return null;
    return {
      version: String(rel.tag_name || '').replace(/^v/i, ''),
      url: asset.browser_download_url,
      size: asset.size,
      notes: rel.body || '',
    };
  } catch {
    return null;
  }
}

async function downloadFile(url, dest, onProgress) {
  const res = await net.fetch(url, { headers: { 'User-Agent': 'VeldboomLauncher' } });
  if (!res.ok) throw new Error(`Download failed (HTTP ${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0;
  const file = fs.createWriteStream(dest);
  const reader = res.body.getReader();
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      if (!file.write(Buffer.from(value))) {
        await new Promise((r) => file.once('drain', r));
      }
      if (onProgress) onProgress(total ? received / total : 0);
    }
    await new Promise((resolve, reject) => {
      file.on('error', reject);
      file.end(resolve);
    });
  } catch (err) {
    file.destroy();
    throw err;
  }
}

function findExe(dir, exeName) {
  const direct = path.join(dir, exeName);
  if (fs.existsSync(direct)) return direct;
  // Zips often contain a top-level folder — search for the exe recursively.
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name.toLowerCase() === path.basename(exeName).toLowerCase()) return full;
    }
  }
  return null;
}

function sendProgress(id, phase, pct) {
  if (win && !win.isDestroyed()) {
    win.webContents.send('game:progress', { id, phase, pct });
  }
}

ipcMain.handle('app:version', () => app.getVersion());

ipcMain.handle('games:list', async () => {
  const res = await net.fetch(`${MANIFEST_URL}?t=${Date.now()}`, {
    headers: { 'User-Agent': 'VeldboomLauncher' },
  });
  if (!res.ok) throw new Error(`Could not load game catalog (HTTP ${res.status})`);
  const manifest = await res.json();
  const installed = readInstalled();
  const games = await Promise.all(
    (manifest.games || []).map(async (g) => {
      const release = await latestRelease(g.repo);
      const inst = installed[g.id];
      let status = 'coming_soon';
      if (release && !inst) status = 'available';
      else if (release && inst) status = inst.version === release.version ? 'installed' : 'update';
      else if (!release && inst) status = 'installed';
      return {
        ...g,
        latest: release,
        installedVersion: inst ? inst.version : null,
        status,
      };
    })
  );
  return games;
});

ipcMain.handle('games:install', async (_e, game) => {
  if (!game.latest) throw new Error('No release available for this game yet.');
  const dir = path.join(gamesDir(), game.id);
  const zipPath = path.join(app.getPath('temp'), `${game.id}.zip`);

  sendProgress(game.id, 'downloading', 0);
  await downloadFile(game.latest.url, zipPath, (p) =>
    sendProgress(game.id, 'downloading', p)
  );

  sendProgress(game.id, 'installing', 1);
  await fsp.rm(dir, { recursive: true, force: true });
  await fsp.mkdir(dir, { recursive: true });
  await extract(zipPath, { dir });
  await fsp.rm(zipPath, { force: true });

  const exePath = findExe(dir, game.exe);
  if (!exePath) throw new Error(`Could not find ${game.exe} in the downloaded files.`);

  const installed = readInstalled();
  installed[game.id] = {
    version: game.latest.version,
    path: dir,
    exe: path.relative(dir, exePath),
  };
  writeInstalled(installed);
  sendProgress(game.id, 'done', 1);
  return installed[game.id];
});

ipcMain.handle('games:launch', async (_e, id) => {
  const inst = readInstalled()[id];
  if (!inst) throw new Error('Game is not installed.');
  const exePath = path.join(inst.path, inst.exe);
  if (!fs.existsSync(exePath)) throw new Error('Game files are missing — reinstall the game.');
  const child = spawn(exePath, [], {
    cwd: path.dirname(exePath),
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  return true;
});

ipcMain.handle('games:uninstall', async (_e, id) => {
  const installed = readInstalled();
  const inst = installed[id];
  if (inst) {
    await fsp.rm(inst.path, { recursive: true, force: true });
    delete installed[id];
    writeInstalled(installed);
  }
  return true;
});

ipcMain.handle('open:external', (_e, url) => {
  if (/^https?:\/\//.test(url)) shell.openExternal(url);
});

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#0d0f14',
    autoHideMenuBar: true,
    title: 'Veldboom Launcher',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();
  if (app.isPackaged) {
    autoUpdater.checkForUpdatesAndNotify().catch(() => {});
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
