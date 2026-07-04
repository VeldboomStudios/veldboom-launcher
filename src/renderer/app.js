let games = [];
let filesData = { loggedIn: false, items: [] };
let user = null;
let selectedId = null;
const busy = new Map(); // progressId -> { phase, pct }

const grid = document.getElementById('game-grid');
const emptyState = document.getElementById('empty-state');
const statusMessage = document.getElementById('status-message');
const overlay = document.getElementById('detail-overlay');
const loginOverlay = document.getElementById('login-overlay');

// --- View switching ---

document.querySelectorAll('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const view = btn.dataset.view;
    document.getElementById('view-library').classList.toggle('hidden', view !== 'library');
    document.getElementById('view-files').classList.toggle('hidden', view !== 'files');
    if (view === 'files') loadFiles();
  });
});

// --- Status helpers ---

function showStatus(el, msg, isError) {
  el.textContent = msg;
  el.style.color = isError ? '#ff6b6b' : '';
  el.classList.remove('hidden');
}

function cleanError(err) {
  return String(err.message || err).replace(/^.*Error: /, '');
}

// --- Auth ---

function renderUser() {
  const box = document.getElementById('user-box');
  if (user) {
    box.innerHTML = `
      <div class="user-row">
        <img class="user-avatar" src="${user.avatar}" alt="" />
        <div class="user-meta">
          <div class="user-name"></div>
          <button id="signout-btn" class="link-btn">Sign out</button>
        </div>
      </div>`;
    box.querySelector('.user-name').textContent = user.name;
    box.querySelector('#signout-btn').addEventListener('click', async () => {
      await window.launcher.authLogout();
      user = null;
      renderUser();
      loadGames();
      loadFiles();
    });
  } else {
    box.innerHTML = '<button id="signin-btn" class="btn btn-primary btn-block">Sign in with GitHub</button>';
    box.querySelector('#signin-btn').addEventListener('click', startLogin);
  }
}

async function startLogin() {
  const codeEl = document.getElementById('login-code');
  const statusEl = document.getElementById('login-status');
  codeEl.textContent = '····-····';
  statusEl.textContent = 'Contacting GitHub…';
  loginOverlay.classList.remove('hidden');
  try {
    const d = await window.launcher.authStart();
    codeEl.textContent = d.userCode;
    statusEl.textContent = 'Waiting for you to approve in the browser…';
    try { await navigator.clipboard.writeText(d.userCode); } catch {}
    user = await window.launcher.authPoll({ deviceCode: d.deviceCode, interval: d.interval });
    loginOverlay.classList.add('hidden');
    renderUser();
    loadGames();
    loadFiles();
  } catch (err) {
    statusEl.textContent = cleanError(err);
    statusEl.style.color = '#ff6b6b';
  }
}

document.getElementById('login-close').addEventListener('click', () => {
  loginOverlay.classList.add('hidden');
});

// --- Library (games) ---

function badgeFor(game) {
  if (busy.has(game.id)) {
    const b = busy.get(game.id);
    const pct = Math.round(b.pct * 100);
    return `<span class="badge busy">${b.phase === 'downloading' ? `Downloading ${pct}%` : 'Installing…'}</span>`;
  }
  const labels = {
    installed: 'Installed',
    available: 'Install',
    update: 'Update available',
    coming_soon: 'Coming soon',
  };
  return `<span class="badge ${game.status}">${labels[game.status] || game.status}</span>`;
}

function renderGrid() {
  grid.innerHTML = '';
  emptyState.classList.toggle('hidden', games.length > 0);
  for (const game of games) {
    const card = document.createElement('div');
    card.className = 'game-card';
    const coverStyle = game.image ? `style="background-image:url('${game.image}')"` : '';
    const initial = game.title ? game.title[0].toUpperCase() : '?';
    const b = busy.get(game.id);
    card.innerHTML = `
      <div class="game-cover" ${coverStyle}>${game.image ? '' : initial}</div>
      <div class="card-progress"><div class="fill" style="width:${b ? b.pct * 100 : 0}%"></div></div>
      <div class="game-info">
        <div class="game-title"></div>
        ${badgeFor(game)}
      </div>`;
    card.querySelector('.game-title').textContent = game.title;
    card.addEventListener('click', () => openDetail(game.id));
    grid.appendChild(card);
  }
}

function openDetail(id) {
  selectedId = id;
  renderDetail();
  overlay.classList.remove('hidden');
}

function closeDetail() {
  selectedId = null;
  overlay.classList.add('hidden');
}

function renderDetail() {
  const game = games.find((g) => g.id === selectedId);
  if (!game) return;

  const hero = document.getElementById('detail-hero');
  hero.style.backgroundImage = game.image ? `url('${game.image}')` : '';
  document.getElementById('detail-title').textContent = game.title;

  const versionEl = document.getElementById('detail-version');
  const parts = [];
  if (game.installedVersion) parts.push(`Installed: v${game.installedVersion}`);
  if (game.latest) parts.push(`Latest: v${game.latest.version}`);
  versionEl.textContent = parts.join('  ·  ') || 'No release yet';

  document.getElementById('detail-desc').textContent = game.description || '';

  const progressWrap = document.getElementById('detail-progress');
  const b = busy.get(game.id);
  if (b) {
    progressWrap.classList.remove('hidden');
    document.getElementById('detail-progress-fill').style.width = `${b.pct * 100}%`;
    document.getElementById('detail-progress-label').textContent =
      b.phase === 'downloading' ? `Downloading… ${Math.round(b.pct * 100)}%` : 'Installing…';
  } else {
    progressWrap.classList.add('hidden');
  }

  const actions = document.getElementById('detail-actions');
  actions.innerHTML = '';

  const addBtn = (label, cls, onClick, disabled) => {
    const btn = document.createElement('button');
    btn.className = `btn ${cls}`;
    btn.textContent = label;
    btn.disabled = !!disabled;
    btn.addEventListener('click', onClick);
    actions.appendChild(btn);
    return btn;
  };

  if (b) {
    addBtn('Working…', 'btn-primary', () => {}, true);
    return;
  }

  if (game.status === 'installed') {
    addBtn('Play', 'btn-play', () => launchGame(game));
    addBtn('Uninstall', 'btn-ghost', () => uninstallGame(game));
  } else if (game.status === 'update') {
    addBtn('Update', 'btn-primary', () => installGame(game));
    addBtn('Play', 'btn-play', () => launchGame(game));
  } else if (game.status === 'available') {
    addBtn('Install', 'btn-primary', () => installGame(game));
  } else {
    addBtn('Coming soon', 'btn-ghost', () => {}, true);
  }
}

async function installGame(game) {
  busy.set(game.id, { phase: 'downloading', pct: 0 });
  renderGrid();
  renderDetail();
  try {
    await window.launcher.install(game);
    busy.delete(game.id);
    await loadGames();
  } catch (err) {
    busy.delete(game.id);
    showStatus(statusMessage, `Install failed: ${cleanError(err)}`, true);
    renderGrid();
    renderDetail();
  }
}

async function launchGame(game) {
  try {
    await window.launcher.launch(game.id);
  } catch (err) {
    showStatus(statusMessage, `Could not start game: ${cleanError(err)}`, true);
  }
}

async function uninstallGame(game) {
  try {
    await window.launcher.uninstall(game.id);
    await loadGames();
  } catch (err) {
    showStatus(statusMessage, `Uninstall failed: ${cleanError(err)}`, true);
  }
}

async function loadGames() {
  try {
    statusMessage.classList.add('hidden');
    games = await window.launcher.listGames();
    renderGrid();
    if (selectedId) renderDetail();
  } catch (err) {
    showStatus(
      statusMessage,
      'Could not load the game catalog. Check your internet connection and try Refresh.',
      true
    );
  }
}

// --- Files ---

function fmtSize(bytes) {
  if (!bytes) return '';
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(1)} MB`;
}

function renderFiles() {
  const list = document.getElementById('files-list');
  const empty = document.getElementById('files-empty');
  list.innerHTML = '';
  empty.classList.toggle('hidden', filesData.items.length > 0);

  for (const item of filesData.items) {
    const row = document.createElement('div');
    row.className = 'file-row';

    let body;
    if (item.access) {
      const assetBtns = item.assets
        .map(
          (a, i) =>
            `<button class="btn btn-primary btn-small" data-idx="${i}">&#x2193; ${a.name}${a.size ? ` (${fmtSize(a.size)})` : ''}</button>`
        )
        .join('');
      body = `
        <div class="file-meta">
          <div class="file-title"></div>
          <div class="file-desc"></div>
          ${item.version ? `<div class="file-version">v${item.version}</div>` : ''}
        </div>
        <div class="file-actions">${assetBtns || '<span class="file-locked">No files in latest release</span>'}</div>`;
    } else {
      const reason = filesData.loggedIn
        ? '&#x1f512; No access — contact Veldboom Studios'
        : '&#x1f512; Sign in to access';
      body = `
        <div class="file-meta">
          <div class="file-title"></div>
          <div class="file-desc"></div>
        </div>
        <div class="file-actions"><span class="file-locked">${reason}</span></div>`;
    }
    row.innerHTML = body;
    row.querySelector('.file-title').textContent = item.title;
    row.querySelector('.file-desc').textContent = item.description || '';

    row.querySelectorAll('button[data-idx]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const asset = item.assets[Number(btn.dataset.idx)];
        const progressId = `file:${asset.id}`;
        btn.disabled = true;
        const original = btn.innerHTML;
        const off = window.launcher.onProgress; // progress handled globally below
        const update = (pct) => {
          btn.textContent = `Downloading ${Math.round(pct * 100)}%`;
        };
        fileProgressHandlers.set(progressId, update);
        try {
          const saved = await window.launcher.fileDownload({
            url: asset.url,
            name: asset.name,
            progressId,
          });
          btn.innerHTML = saved ? '&#x2713; Downloaded' : original;
          if (!saved) btn.disabled = false;
        } catch (err) {
          showStatus(document.getElementById('files-status'), `Download failed: ${cleanError(err)}`, true);
          btn.innerHTML = original;
          btn.disabled = false;
        } finally {
          fileProgressHandlers.delete(progressId);
        }
      });
    });

    list.appendChild(row);
  }
}

const fileProgressHandlers = new Map();

async function loadFiles() {
  try {
    document.getElementById('files-status').classList.add('hidden');
    filesData = await window.launcher.filesList();
    renderFiles();
  } catch (err) {
    showStatus(document.getElementById('files-status'), 'Could not load files list.', true);
  }
}

// --- Global progress events ---

window.launcher.onProgress(({ id, phase, pct }) => {
  const fileHandler = fileProgressHandlers.get(id);
  if (fileHandler) {
    if (phase === 'downloading') fileHandler(pct);
    return;
  }
  if (phase === 'done') {
    busy.delete(id);
  } else {
    busy.set(id, { phase, pct });
  }
  renderGrid();
  if (selectedId === id) renderDetail();
});

// --- Wire up ---

document.getElementById('refresh-btn').addEventListener('click', loadGames);
document.getElementById('files-refresh-btn').addEventListener('click', loadFiles);
document.getElementById('detail-close').addEventListener('click', closeDetail);
overlay.addEventListener('click', (e) => {
  if (e.target === overlay) closeDetail();
});

window.launcher.version().then((v) => {
  document.getElementById('launcher-version').textContent = `Launcher v${v}`;
});

window.launcher.authStatus().then((u) => {
  user = u;
  renderUser();
});

renderUser();
loadGames();
