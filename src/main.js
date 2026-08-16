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

// Set VELDBOOM_CATALOG to preview a catalog locally before publishing it.
const MANIFEST_URL =
  process.env.VELDBOOM_CATALOG ||
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
//
// Stored shape is a JSON record so we can keep the grant kind and expiry next to
// the token. Older builds wrote the bare token string; loadAuth() still reads those.

function saveAuth(record) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Secure storage is not available on this system.');
  }
  fs.mkdirSync(path.dirname(tokenFile()), { recursive: true });
  fs.writeFileSync(tokenFile(), safeStorage.encryptString(JSON.stringify(record)));
}

function loadAuth() {
  let raw;
  try {
    raw = safeStorage.decryptString(fs.readFileSync(tokenFile()));
  } catch {
    return null;
  }
  // Legacy format: the file held nothing but the OAuth App token.
  if (!raw.startsWith('{')) return { token: raw, kind: 'oauth-app', expiresAt: null };
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function loadToken() {
  const auth = loadAuth();
  if (!auth || !auth.token) return null;
  // A GitHub App that still has user-to-server expiry switched on hands out 8-hour
  // tokens. Refreshing one needs the app's client_secret, which a desktop app cannot
  // hold — so an expired token is dropped and the user signs in again. See SECURITY.md.
  if (auth.expiresAt && Date.now() >= auth.expiresAt) {
    clearToken();
    return null;
  }
  return auth.token;
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
    const assets = rel.assets || [];
    // Builds over GitHub's 2 GiB asset limit ship as byte-split volumes
    // (Game.zip.001, .002, ...) — concatenated in order they form one zip.
    let zipAssets = assets
      .filter((a) => /\.zip\.\d{3}$/i.test(a.name))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (!zipAssets.length) {
      const single = assets.find((a) => a.name.toLowerCase().endsWith('.zip'));
      if (!single) return null;
      zipAssets = [single];
    }
    const toUrl = (a) => `https://api.github.com/repos/${repo}/releases/assets/${a.id}`;
    return {
      version: String(rel.tag_name || '').replace(/^v/i, ''),
      assetUrl: toUrl(zipAssets[0]),
      parts: zipAssets.map((a) => ({ assetUrl: toUrl(a), size: a.size || 0 })),
      size: zipAssets.reduce((s, a) => s + (a.size || 0), 0),
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
  return downloadAssetParts([{ assetUrl, size: 0 }], dest, onProgress);
}

// Downloads one or more assets sequentially into a single file. Split-volume
// releases (.zip.001, .002, ...) reassemble into the original zip this way.
async function downloadAssetParts(parts, dest, onProgress) {
  let totalAll = parts.reduce((s, p) => s + (p.size || 0), 0);
  const file = fs.createWriteStream(dest);
  let received = 0;
  try {
    for (const part of parts) {
      const res = await ghFetch(part.assetUrl, { Accept: 'application/octet-stream' });
      if (!res.ok) throw new Error(`Download failed (HTTP ${res.status})`);
      if (!part.size) {
        totalAll += Number(res.headers.get('content-length')) || 0;
      }
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.length;
        if (!file.write(Buffer.from(value))) {
          await new Promise((r) => file.once('drain', r));
        }
        if (onProgress) onProgress(totalAll ? received / totalAll : 0);
      }
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

// Which GitHub identity the launcher signs in with.
//
// Preferred: a GitHub App (`githubAppClientId`). Its user-to-server token reaches only
// the intersection of "repos the app installation covers" (VeldboomStudios content repos)
// and "repos this user can read" — so it can never touch the user's own repositories,
// and permissions come from the app registration rather than a scope string.
//
// Fallback: the original OAuth App (`githubClientId`), which needs the `repo` scope —
// read AND write on every repo the user can see. Kept only so sign-in keeps working
// until the GitHub App is live; the launcher tells the user which one is in use.
function authClient(manifest) {
  if (manifest.githubAppClientId) {
    return { clientId: manifest.githubAppClientId, kind: 'github-app' };
  }
  if (manifest.githubClientId) {
    return { clientId: manifest.githubClientId, kind: 'oauth-app' };
  }
  return null;
}

ipcMain.handle('auth:start', async () => {
  const manifest = await getManifest();
  const client = authClient(manifest);
  if (!client) throw new Error('Sign-in is not configured yet. Try again later.');
  const body = { client_id: client.clientId };
  // GitHub Apps derive access from their registered permissions; sending a scope here
  // is what produced the over-broad `repo` grant, so only the legacy path sets it.
  if (client.kind === 'oauth-app') body.scope = 'repo';
  const res = await net.fetch(DEVICE_CODE_URL, {
    method: 'POST',
    headers: {
      'User-Agent': 'VeldboomLauncher',
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const d = await res.json();
  if (!d.device_code) throw new Error(d.error_description || 'Could not start sign-in.');
  shell.openExternal(d.verification_uri);
  return {
    userCode: d.user_code,
    verificationUri: d.verification_uri,
    deviceCode: d.device_code,
    interval: d.interval || 5,
    grant: client.kind,
  };
});

ipcMain.handle('auth:poll', async (_e, { deviceCode, interval }) => {
  const manifest = await getManifest();
  const client = authClient(manifest);
  if (!client) throw new Error('Sign-in is not configured yet. Try again later.');
  const clientId = client.clientId;
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
      // `expires_in` only comes back when the GitHub App still has user-to-server token
      // expiry enabled. We record it so an expired token is dropped cleanly instead of
      // failing every API call 8 hours later — but the fix is to opt out of expiry
      // (see README), because refreshing needs a client_secret we cannot ship.
      saveAuth({
        token: d.access_token,
        kind: client.kind,
        expiresAt: d.expires_in ? Date.now() + Number(d.expires_in) * 1000 : null,
      });
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

// --- Privacy / transparency IPC ---
//
// Everything the launcher knows about a user lives on their own machine; there is no
// Veldboom server and no analytics. These handlers let the app show that honestly and
// let the user erase it (GDPR art. 15 access / art. 17 erasure, exercised locally).

function dirSize(dir) {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else {
        try {
          total += fs.statSync(full).size;
        } catch {
          // vanished mid-walk — ignore
        }
      }
    }
  }
  return total;
}

// What signing in actually grants, in the user's words. Shown before they sign in.
function grantInfo(kind) {
  if (kind === 'github-app') {
    return {
      grant: 'github-app',
      title: 'Veldboom Launcher (GitHub App)',
      grants: [
        'Read your GitHub username, display name and avatar.',
        'Read releases and download files from Veldboom Studios repositories you already have access to.',
      ],
      cannot: [
        'It cannot read, write or delete any of your own repositories.',
        'It cannot post, comment or act as you anywhere on GitHub.',
      ],
      warning: null,
    };
  }
  return {
    grant: 'oauth-app',
    title: 'Veldboom Launcher (legacy OAuth App)',
    grants: [
      'Read your GitHub username, display name and avatar.',
      'Read releases and download files from Veldboom Studios repositories you have access to.',
    ],
    cannot: [],
    warning:
      'This legacy sign-in asks GitHub for the "repo" scope, which grants read AND write access to every repository your account can see — far more than the launcher needs. Only sign in if you accept that.',
  };
}

ipcMain.handle('privacy:grant', async () => {
  try {
    const manifest = await getManifest();
    const client = authClient(manifest);
    return grantInfo(client ? client.kind : 'github-app');
  } catch {
    // Offline: describe the intended grant rather than blocking the dialog.
    return grantInfo('github-app');
  }
});

ipcMain.handle('privacy:summary', async () => {
  const installed = readInstalled();
  // loadToken() first: it prunes an expired token, so loadAuth() below cannot report
  // "signed in" for a grant that every other call site already treats as gone.
  const hasToken = !!loadToken();
  const auth = hasToken ? loadAuth() : null;
  let account = null;
  try {
    account = await currentUser();
  } catch {
    // offline — the local record below still tells the truth
  }
  return {
    signedIn: !!auth,
    grant: auth ? auth.kind : null,
    account: account ? { login: account.login, name: account.name } : null,
    storedLocally: {
      tokenFile: fs.existsSync(tokenFile()) ? tokenFile() : null,
      installedFile: fs.existsSync(installedFile()) ? installedFile() : null,
      gamesDir: fs.existsSync(gamesDir()) ? gamesDir() : null,
      gamesBytes: fs.existsSync(gamesDir()) ? dirSize(gamesDir()) : 0,
      gameCount: Object.keys(installed).length,
      playtimeTracked: Object.values(installed).some((i) => i && i.playMs),
    },
    thirdParties: [
      {
        name: 'GitHub, Inc.',
        why: 'Hosts the catalog, the game and file downloads, and the sign-in. Receives your IP address, and your GitHub identity once you sign in.',
        policy: 'https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement',
      },
      {
        name: 'Google (YouTube)',
        why: 'Only if you open a product video or its thumbnail loads. Receives your IP address and YouTube cookies, exactly as visiting youtube.com would.',
        policy: 'https://policies.google.com/privacy',
      },
    ],
    noAnalytics: true,
  };
});

// Erasure: drop the token, the install records and every installed game (which also
// removes the veldboom_session.json written next to each game at launch).
ipcMain.handle('privacy:deleteData', async () => {
  const removed = [];
  if (fs.existsSync(tokenFile())) {
    clearToken();
    removed.push('Sign-in token');
  }
  if (fs.existsSync(installedFile())) {
    await fsp.rm(installedFile(), { force: true });
    removed.push('Install records and playtime');
  }
  if (fs.existsSync(gamesDir())) {
    await fsp.rm(gamesDir(), { recursive: true, force: true });
    removed.push('Installed game files');
  }
  return { removed };
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
  const parts = game.latest.parts || [{ assetUrl: game.latest.assetUrl, size: total }];
  await downloadAssetParts(parts, zipPath, (p) => {
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
    // Launch arguments from the catalogue. An Unreal build made out of a slice of a larger
    // project still boots that project's default map, and the map cannot be changed after
    // packaging — a cooked build keeps its config inside the pak, so there is no ini left on
    // disk to edit. Passing the map on the command line is the honest fix, and it belongs in
    // the catalogue rather than hard-coded here so a title can carry whatever it needs.
    args: Array.isArray(game.args) ? game.args : [],
  };
  writeInstalled(installed);
  sendProgress(game.id, 'done', 1);
  return installed[game.id];
});

// Account link: hand the game who is playing and which DLC they own, refreshed at
// every launch. Written next to the game files AND passed as -VeldboomSession=<path>
// (UE reads it via FParse; other engines can just read veldboom_session.json).
async function writeSessionManifest(id, inst) {
  let player = null;
  try { player = await currentUser(); } catch {}
  const ownedDlc = [];
  try {
    const manifest = await getManifest();
    const game = (manifest.games || []).find((g) => g.id === id);
    for (const d of (game && game.dlc) || []) {
      // Access to the private DLC repo's latest release = owned entitlement.
      if (await latestRelease(d.repo)) ownedDlc.push(d.id);
    }
  } catch {
    // Offline: fall back to DLC that is physically installed.
    for (const k of Object.keys(inst.dlc || {})) ownedDlc.push(k);
  }
  for (const k of Object.keys(inst.dlc || {})) {
    if (!ownedDlc.includes(k)) ownedDlc.push(k);
  }
  const session = {
    player: player ? { login: player.login, name: player.name } : null,
    dlc: ownedDlc,
    installedDlc: inst.dlc || {},
    issuedAt: new Date().toISOString(),
  };
  const file = path.join(inst.path, 'veldboom_session.json');
  await fsp.writeFile(file, JSON.stringify(session, null, 2));
  return file;
}

ipcMain.handle('games:launch', async (_e, id) => {
  const inst = readInstalled()[id];
  if (!inst) throw new Error('Game is not installed.');
  const exePath = path.join(inst.path, inst.exe);
  if (!fs.existsSync(exePath)) throw new Error('Game files are missing — reinstall the game.');
  if (runningGames.has(id)) throw new Error('Game is already running.');
  let sessionArgs = [];
  try {
    const sessionFile = await writeSessionManifest(id, inst);
    sessionArgs = [`-VeldboomSession=${sessionFile}`];
  } catch {
    // Account link is best-effort — never block a launch on it.
  }
  // Catalogue arguments first, then the session handle, so a title's own launch options
  // cannot be shadowed by ours. Older install records predate this field and have none.
  const gameArgs = Array.isArray(inst.args) ? inst.args : [];
  const child = spawn(exePath, [...gameArgs, ...sessionArgs], {
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

// Best-effort. Under the GitHub App grant the /user/repository_invitations endpoints sit
// behind the "Administration" permission, which the launcher deliberately does not ask
// for — so this quietly returns 0 and the buyer accepts the invite from GitHub's own
// email/notification instead. Never block a purchase on it.
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
  const dlcParts = dlc.latest.parts || [{ assetUrl: dlc.latest.assetUrl, size: dlc.latest.size || 0 }];
  await downloadAssetParts(dlcParts, zipPath, (p) => sendProgress(progressId, 'downloading', p));

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

// Product videos open in their own launcher window rather than an <iframe>.
// The renderer is loaded from file://, and YouTube's player refuses to run when
// its parent origin is file:// — an embedded frame answers "error 152", and the
// /embed/ page opened top-level answers "error 153" because it has no referrer.
// The ordinary watch URL has a genuine origin and plays; Google shows its
// cookie notice on first use, exactly as it would in a browser.
let mediaWin = null;

ipcMain.handle('media:play', (_e, { url, title }) => {
  if (!/^https:\/\/www\.youtube\.com\/watch\?v=[\w-]+$/.test(url)) return false;
  if (mediaWin && !mediaWin.isDestroyed()) {
    mediaWin.loadURL(url);
    mediaWin.focus();
    return true;
  }
  mediaWin = new BrowserWindow({
    width: 1000,
    height: 640,
    parent: win,
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    title: title || 'Veldboom Launcher',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  mediaWin.on('closed', () => { mediaWin = null; });
  mediaWin.loadURL(url);
  return true;
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
    icon: path.join(__dirname, 'renderer', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

function sendUpdaterStatus(data) {
  if (win && !win.isDestroyed()) win.webContents.send('updater:status', data);
}

autoUpdater.on('update-available', (info) => {
  sendUpdaterStatus({ state: 'downloading', version: info.version });
});
autoUpdater.on('download-progress', (p) => {
  sendUpdaterStatus({ state: 'downloading', pct: p.percent });
});
autoUpdater.on('update-downloaded', (info) => {
  sendUpdaterStatus({ state: 'ready', version: info.version });
});
autoUpdater.on('error', () => {
  sendUpdaterStatus({ state: 'hidden' });
});

ipcMain.handle('updater:install', () => {
  autoUpdater.quitAndInstall();
});

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
