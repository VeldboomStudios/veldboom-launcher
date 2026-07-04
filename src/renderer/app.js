let games = [];
let selectedId = null;
const busy = new Map(); // id -> { phase, pct }

const grid = document.getElementById('game-grid');
const emptyState = document.getElementById('empty-state');
const statusMessage = document.getElementById('status-message');
const overlay = document.getElementById('detail-overlay');

function showStatus(msg, isError) {
  statusMessage.textContent = msg;
  statusMessage.style.color = isError ? '#ff6b6b' : '';
  statusMessage.classList.remove('hidden');
}

function hideStatus() {
  statusMessage.classList.add('hidden');
}

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
    showStatus(`Install failed: ${err.message.replace(/^.*Error: /, '')}`, true);
    renderGrid();
    renderDetail();
  }
}

async function launchGame(game) {
  try {
    await window.launcher.launch(game.id);
  } catch (err) {
    showStatus(`Could not start game: ${err.message.replace(/^.*Error: /, '')}`, true);
  }
}

async function uninstallGame(game) {
  try {
    await window.launcher.uninstall(game.id);
    await loadGames();
  } catch (err) {
    showStatus(`Uninstall failed: ${err.message.replace(/^.*Error: /, '')}`, true);
  }
}

async function loadGames() {
  try {
    hideStatus();
    games = await window.launcher.listGames();
    renderGrid();
    if (selectedId) renderDetail();
  } catch (err) {
    showStatus(
      'Could not load the game catalog. Check your internet connection and try Refresh.',
      true
    );
  }
}

window.launcher.onProgress(({ id, phase, pct }) => {
  if (phase === 'done') {
    busy.delete(id);
  } else {
    busy.set(id, { phase, pct });
  }
  renderGrid();
  if (selectedId === id) renderDetail();
});

document.getElementById('refresh-btn').addEventListener('click', loadGames);
document.getElementById('detail-close').addEventListener('click', closeDetail);
overlay.addEventListener('click', (e) => {
  if (e.target === overlay) closeDetail();
});

window.launcher.version().then((v) => {
  document.getElementById('launcher-version').textContent = `Launcher v${v}`;
});

loadGames();
