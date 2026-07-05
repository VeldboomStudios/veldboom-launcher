const {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  net,
  safeStorage,
  dialog,
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { spawn } = require('node:child_process');
const extract = require('extract-zip');
const { autoUpdater } = require('electron-updater');

const MANIFEST_URL =
  'https://raw.githubusercontent.com/VeldboomStudios/veldboom-launcher/main/games.json';
const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';

let win = null;

const gamesDir = () => path.join(app.getPath('userData'), 'games');
const installedFile = () => path.join(app.getPath('userData'), 'installed.json');
const tokenFile = () => path.join(app.getPath('userData'), 'auth.bin');

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

// --- Auth token storage (encrypted at rest via OS keychain / DPAPI) ---

function saveToken(token) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Secure storage is not available on this system.');
  }
  fs.mkdirSync(path.dirname(tokenFile()), { recursive: true });
  fs.writeFileSync(tokenFile(), safeStorage.encryptString(token));
}

function loadToken() {
  try {
    return safeStorage.decryptString(fs.readFileSync(tokenFile()));
  } catch {
    return null;
  }
}

function clearToken() {
  fs.rmSync(tokenFile(), { force: true });
}

// --- GitHub helpers ---

async function ghFetch(url, extraHeaders = {}) {
  const headers = {
    'User-Agent': 'VeldboomLauncher',
    Accept: 'application/vnd.github+json',
    ...extraHeaders,
  };
  const token = loadToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return net.fetch(url, { headers });
}

async function getManifest() {
  const res = await net.fetch(`${MANIFEST_URL}?t=${Date.now()}`, {
    headers: { 'User-Agent': 'VeldboomLauncher' },
  });
  if (!res.ok) throw new Error(`Could not load catalog (HTTP ${res.status})`);
  return res.json();
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
      assetUrl: `https://api.github.com/repos/${repo}/releases/assets/${asset.id}`,
      size: asset.size,
      notes: rel.body || '',
    };
  } catch {
    return null;
  }
}

// Downloads a release asset. Works for public repos unauthenticated and for
// private repos with the stored token; GitHub redirects to a short-lived
// storage URL and fetch drops the Authorization header on the cross-origin hop.
async function downloadAsset(assetUrl, dest, onProgress) {
  const res = await ghFetch(assetUrl, { Accept: 'application/octet-stream' });
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

function sendProgress(id, phase, pct, extra = {}) {
  if (win && !win.isDestroyed()) {
    win.webContents.send('game:progress', { id, phase, pct, ...extra });
  }
}

const runningGames = new Set();

function sendRunning(id, running) {
  if (running) runningGames.add(id);
  else runningGames.delete(id);
  if (win && !win.isDestroyed()) {
    win.webContents.send('game:running', { id, running });
  }
}

// --- Auth IPC ---

async function currentUser() {
  if (!loadToken()) return null;
  const res = await ghFetch('https://api.github.com/user');
  if (!res.ok) return null;
  const u = await res.json();
  return { login: u.login, name: u.name || u.login, avatar: u.avatar_url };
}

ipcMain.handle('auth:start', async () => {
  const manifest = await getManifest();
  const clientId = manifest.githubClientId;
  if (!clientId) throw new Error('Sign-in is not configured yet. Try again later.');
  const res = await net.fetch(DEVICE_CODE_URL, {
    method: 'POST',
    headers: {
      'User-Agent': 'VeldboomLauncher',
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ client_id: clientId, scope: 'repo' }),
  });
  const d = await res.json();
  if (!d.device_code) throw new Error(d.error_description || 'Could not start sign-in.');
  shell.openExternal(d.verification_uri);
  return {
    userCode: d.user_code,
    verificationUri: d.verification_uri,
    deviceCode: d.device_code,
    interval: d.interval || 5,
  };
});

ipcMain.handle('auth:poll', async (_e, { deviceCode, interval }) => {
  const manifest = await getManifest();
  const clientId = manifest.githubClientId;
  const deadline = Date.now() + 15 * 60 * 1000;
  let waitMs = Math.max(interval || 5, 5) * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, waitMs));
    const res = await net.fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'User-Agent': 'VeldboomLauncher',
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: clientId,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    });
    const d = await res.json();
    if (d.access_token) {
      saveToken(d.access_token);
      return currentUser();
    }
    if (d.error === 'authorization_pending') continue;
    if (d.error === 'slow_down') {
      waitMs += 5000;
      continue;
    }
    throw new Error(d.error_description || d.error || 'Sign-in failed.');
  }
  throw new Error('Sign-in timed out — try again.');
});

ipcMain.handle('auth:status', () => currentUser());

ipcMain.handle('auth:logout', () => {
  clearToken();
  return true;
});

// --- Games IPC ---

ipcMain.handle('games:list', async () => {
  const manifest = await getManifest();
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
        playMs: inst ? inst.playMs || 0 : 0,
        lastPlayed: inst ? inst.lastPlayed || null : null,
        running: runningGames.has(g.id),
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
  // Progress with live speed: smooth bytes/sec over a short window.
  let lastT = Date.now();
  let lastP = 0;
  let bps = 0;
  const total = game.latest.size || 0;
  await downloadAsset(game.latest.assetUrl, zipPath, (p) => {
    const now = Date.now();
    if (now - lastT > 400) {
      bps = ((p - lastP) * total) / ((now - lastT) / 1000);
      lastT = now;
      lastP = p;
    }
    sendProgress(game.id, 'downloading', p, { total, bps });
  });

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
  if (runningGames.has(id)) throw new Error('Game is already running.');
  const child = spawn(exePath, [], {
    cwd: path.dirname(exePath),
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  // Playtime: count until the process we spawned exits (session lost if the launcher closes first).
  const started = Date.now();
  sendRunning(id, true);
  child.on('exit', () => {
    sendRunning(id, false);
    const installed = readInstalled();
    if (installed[id]) {
      installed[id].playMs = (installed[id].playMs || 0) + (Date.now() - started);
      installed[id].lastPlayed = new Date().toISOString();
      writeInstalled(installed);
    }
  });
  child.on('error', () => sendRunning(id, false));
  return true;
});

ipcMain.handle('news:list', async () => {
  const manifest = await getManifest();
  return manifest.news || [];
});

// --- DLC ---
// A DLC is a private GitHub repo with releases. Buying (Stripe payment link) triggers a
// webhook that invites the buyer's GitHub account to the repo; we auto-accept the invite
// with their token, so paid DLC unlocks without keys or manual steps.

async function acceptPendingInvites(fromOwner) {
  if (!loadToken()) return 0;
  try {
    const res = await ghFetch('https://api.github.com/user/repository_invitations');
    if (!res.ok) return 0;
    const invites = await res.json();
    let accepted = 0;
    for (const inv of invites) {
      const owner = inv.repository && inv.repository.owner ? inv.repository.owner.login : '';
      if (fromOwner && owner.toLowerCase() !== fromOwner.toLowerCase()) continue;
      const patch = await net.fetch(`https://api.github.com/user/repository_invitations/${inv.id}`, {
        method: 'PATCH',
        headers: {
          'User-Agent': 'VeldboomLauncher',
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${loadToken()}`,
        },
      });
      if (patch.ok) accepted++;
    }
    return accepted;
  } catch {
    return 0;
  }
}

ipcMain.handle('dlc:list', async (_e, gameId) => {
  const manifest = await getManifest();
  const game = (manifest.games || []).find((g) => g.id === gameId);
  const dlcDefs = game && game.dlc ? game.dlc : [];
  if (!dlcDefs.length) return { loggedIn: !!loadToken(), items: [] };

  // Auto-accept any pending Veldboom invites first, so a fresh purchase unlocks right here.
  await acceptPendingInvites('VeldboomStudios');

  const installed = readInstalled();
  const inst = installed[gameId] || {};
  const ownedDlc = inst.dlc || {};
  const items = await Promise.all(
    dlcDefs.map(async (d) => {
      const release = await latestRelease(d.repo);
      let status = 'locked'; // not purchased (or not signed in)
      if (release && ownedDlc[d.id]) {
        status = ownedDlc[d.id].version === release.version ? 'installed' : 'update';
      } else if (release) {
        status = 'available'; // has access -> can install
      }
      return { ...d, latest: release, installedVersion: ownedDlc[d.id] ? ownedDlc[d.id].version : null, status };
    })
  );
  return { loggedIn: !!loadToken(), items };
});

ipcMain.handle('dlc:buy', async (_e, { buyUrl }) => {
  if (!/^https?:\/\//.test(buyUrl || '')) throw new Error('This DLC has no store link yet.');
  // Attach the GitHub login so the payment webhook knows which account to unlock.
  const u = await currentUser();
  const url = new URL(buyUrl);
  if (u) url.searchParams.set('client_reference_id', u.login);
  shell.openExternal(url.toString());
  return true;
});

ipcMain.handle('dlc:install', async (_e, { gameId, dlc }) => {
  if (!dlc.latest) throw new Error('No release available for this DLC yet.');
  const installed = readInstalled();
  const inst = installed[gameId];
  if (!inst) throw new Error('Install the game first — DLC files go into its folder.');

  const progressId = `dlc:${dlc.id}`;
  const zipPath = path.join(app.getPath('temp'), `${gameId}-${dlc.id}.zip`);
  sendProgress(progressId, 'downloading', 0);
  await downloadAsset(dlc.latest.assetUrl, zipPath, (p) => sendProgress(progressId, 'downloading', p));

  sendProgress(progressId, 'installing', 1);
  // DLC extracts into the game's install dir (packs ship paths relative to the game root).
  await extract(zipPath, { dir: inst.path });
  await fsp.rm(zipPath, { force: true });

  inst.dlc = inst.dlc || {};
  inst.dlc[dlc.id] = { version: dlc.latest.version };
  writeInstalled(installed);
  sendProgress(progressId, 'done', 1);
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

// --- Gated files IPC ---

ipcMain.handle('files:list', async () => {
  const manifest = await getManifest();
  const loggedIn = !!loadToken();
  const items = await Promise.all(
    (manifest.files || []).map(async (f) => {
      let access = false;
      let version = null;
      let assets = [];
      try {
        const res = await ghFetch(`https://api.github.com/repos/${f.repo}/releases/latest`);
        if (res.ok) {
          const rel = await res.json();
          access = true;
          version = String(rel.tag_name || '').replace(/^v/i, '');
          assets = (rel.assets || []).map((a) => ({
            id: a.id,
            name: a.name,
            size: a.size,
            url: `https://api.github.com/repos/${f.repo}/releases/assets/${a.id}`,
          }));
        }
      } catch {
        // no access or offline — shows as locked
      }
      return { ...f, access, version, assets };
    })
  );
  return { loggedIn, items };
});

ipcMain.handle('files:download', async (_e, { url, name, progressId }) => {
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: path.join(app.getPath('downloads'), name),
  });
  if (canceled || !filePath) return null;
  sendProgress(progressId, 'downloading', 0);
  try {
    await downloadAsset(url, filePath, (p) => sendProgress(progressId, 'downloading', p));
    sendProgress(progressId, 'done', 1);
    shell.showItemInFolder(filePath);
    return filePath;
  } catch (err) {
    sendProgress(progressId, 'done', 1);
    throw err;
  }
});

ipcMain.handle('app:version', () => app.getVersion());

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
