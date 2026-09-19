let games = [];
let filesData = { loggedIn: false, items: [] };
let user = null;
let selectedId = null;
const busy = new Map(); // progressId -> { phase, pct, total, bps }
const running = new Set(); // game ids with a live process

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

// Sign-in is two steps on purpose: the user sees what the grant actually covers before
// anything is sent to GitHub, rather than discovering it on GitHub's own consent page.
async function startLogin() {
  const consentStep = document.getElementById('login-consent');
  const codeStep = document.getElementById('login-code-step');
  consentStep.classList.remove('hidden');
  codeStep.classList.add('hidden');
  loginOverlay.classList.remove('hidden');

  const grantsEl = document.getElementById('consent-grants');
  const cannotEl = document.getElementById('consent-cannot');
  const cannotBlock = document.getElementById('consent-cannot-block');
  const warningEl = document.getElementById('consent-warning');
  grantsEl.textContent = '';
  cannotEl.textContent = '';

  const info = await window.launcher.privacyGrant();
  for (const line of info.grants) {
    const li = document.createElement('li');
    li.textContent = line;
    grantsEl.appendChild(li);
  }
  for (const line of info.cannot) {
    const li = document.createElement('li');
    li.textContent = line;
    cannotEl.appendChild(li);
  }
  cannotBlock.classList.toggle('hidden', !info.cannot.length);
  warningEl.textContent = info.warning || '';
  warningEl.classList.toggle('hidden', !info.warning);
}

async function runDeviceFlow() {
  const consentStep = document.getElementById('login-consent');
  const codeStep = document.getElementById('login-code-step');
  const codeEl = document.getElementById('login-code');
  const statusEl = document.getElementById('login-status');
  consentStep.classList.add('hidden');
  codeStep.classList.remove('hidden');
  codeEl.textContent = '····-····';
  statusEl.textContent = 'Contacting GitHub…';
  statusEl.style.color = '';
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

document.getElementById('consent-continue').addEventListener('click', runDeviceFlow);
document.getElementById('consent-cancel').addEventListener('click', () => {
  loginOverlay.classList.add('hidden');
});
document.getElementById('consent-privacy-link').addEventListener('click', () => {
  loginOverlay.classList.add('hidden');
  openPrivacy();
});

document.getElementById('login-close').addEventListener('click', () => {
  loginOverlay.classList.add('hidden');
});

// --- Privacy panel ---

const privacyOverlay = document.getElementById('privacy-overlay');
const POLICY_URL = 'https://github.com/VeldboomStudios/veldboom-launcher/blob/main/PRIVACY.md';
const SECURITY_URL = 'https://github.com/VeldboomStudios/veldboom-launcher/blob/main/SECURITY.md';

function formatBytes(n) {
  if (!n) return '0 MB';
  const mb = n / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(mb))} MB`;
}

function renderPrivacy(s) {
  const body = document.getElementById('privacy-body');
  body.textContent = '';

  const section = (title) => {
    const h = document.createElement('h3');
    h.className = 'privacy-heading';
    h.textContent = title;
    body.appendChild(h);
    const ul = document.createElement('ul');
    ul.className = 'privacy-list';
    body.appendChild(ul);
    return ul;
  };
  const row = (ul, label, value) => {
    const li = document.createElement('li');
    const b = document.createElement('strong');
    b.textContent = `${label}: `;
    li.appendChild(b);
    li.appendChild(document.createTextNode(value));
    ul.appendChild(li);
  };

  const account = section('Account');
  if (s.signedIn && s.account) {
    row(account, 'Signed in as', `${s.account.name} (@${s.account.login})`);
    row(
      account,
      'Sign-in type',
      s.grant === 'github-app'
        ? 'GitHub App — cannot touch your own repositories'
        : 'Legacy OAuth App — grants the broad "repo" scope'
    );
  } else {
    row(account, 'Signed in', 'No — the launcher works signed out for public games');
  }

  const stored = section('Stored on this computer');
  const sl = s.storedLocally;
  row(stored, 'Sign-in token', sl.tokenFile ? `Encrypted at ${sl.tokenFile}` : 'None stored');
  row(
    stored,
    'Installed games',
    sl.gameCount ? `${sl.gameCount} game(s), ${formatBytes(sl.gamesBytes)} in ${sl.gamesDir}` : 'None'
  );
  row(
    stored,
    'Playtime',
    sl.playtimeTracked
      ? s.telemetry === true
        ? 'Recorded locally; session lengths are shared as anonymous usage stats (see below)'
        : 'Recorded locally, never sent anywhere'
      : 'Nothing recorded'
  );

  const third = section('Who else sees anything');
  for (const t of s.thirdParties) {
    const li = document.createElement('li');
    const b = document.createElement('strong');
    b.textContent = `${t.name}: `;
    li.appendChild(b);
    li.appendChild(document.createTextNode(t.why + ' '));
    const a = document.createElement('button');
    a.className = 'link-btn';
    a.textContent = 'Their policy';
    a.addEventListener('click', () => window.launcher.openExternal(t.policy));
    li.appendChild(a);
    third.appendChild(li);
  }

  const stats = section('Usage statistics (optional)');
  const statsLi = document.createElement('li');
  const statsB = document.createElement('strong');
  statsB.textContent = 'Anonymous usage stats: ';
  statsLi.appendChild(statsB);
  statsLi.appendChild(
    document.createTextNode(
      s.telemetry === true
        ? 'ON — install/launch events, playtime, launcher version and country, under a random ID. Never your name, GitHub account, IP address or files. '
        : 'OFF — nothing is sent. '
    )
  );
  const toggle = document.createElement('button');
  toggle.className = 'link-btn';
  toggle.textContent = s.telemetry === true ? 'Turn off (deletes the ID)' : 'Turn on';
  toggle.addEventListener('click', async () => {
    await window.launcher.telemetrySetConsent(s.telemetry !== true);
    renderPrivacy(await window.launcher.privacySummary());
  });
  statsLi.appendChild(toggle);
  stats.appendChild(statsLi);

  const none = section('Not collected');
  row(none, 'Browsing or personal data', 'No IP addresses stored, no file contents, no GitHub identity in usage stats');
  row(none, 'AI features', 'None — the launcher contains no AI and sends nothing to any AI service');
}

async function openPrivacy() {
  privacyOverlay.classList.remove('hidden');
  document.getElementById('privacy-delete-status').classList.add('hidden');
  document.getElementById('privacy-body').textContent = 'Loading…';
  try {
    renderPrivacy(await window.launcher.privacySummary());
  } catch (err) {
    document.getElementById('privacy-body').textContent = cleanError(err);
  }
}

document.getElementById('privacy-open').addEventListener('click', openPrivacy);
document.getElementById('privacy-close').addEventListener('click', () => {
  privacyOverlay.classList.add('hidden');
});
document.getElementById('privacy-policy-btn').addEventListener('click', () => {
  window.launcher.openExternal(POLICY_URL);
});
document.getElementById('privacy-security-btn').addEventListener('click', () => {
  window.launcher.openExternal(SECURITY_URL);
});

document.getElementById('privacy-delete-btn').addEventListener('click', async () => {
  const btn = document.getElementById('privacy-delete-btn');
  const statusEl = document.getElementById('privacy-delete-status');
  statusEl.classList.remove('hidden');
  statusEl.style.color = '';

  if (btn.dataset.confirm !== 'yes') {
    btn.dataset.confirm = 'yes';
    btn.textContent = 'Really delete everything?';
    statusEl.textContent =
      'This signs you out and deletes every installed game and its saved playtime from this computer. Click again to confirm.';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Deleting…';
  try {
    const { removed } = await window.launcher.privacyDeleteData();
    user = null;
    renderUser();
    statusEl.textContent = removed.length
      ? `Deleted: ${removed.join(', ')}.`
      : 'Nothing was stored — there was nothing to delete.';
    renderPrivacy(await window.launcher.privacySummary());
    loadGames();
    loadFiles();
  } catch (err) {
    statusEl.textContent = cleanError(err);
    statusEl.style.color = '#ff6b6b';
  } finally {
    btn.disabled = false;
    btn.dataset.confirm = '';
    btn.textContent = 'Delete my data';
  }
});

// --- Usage-stats consent (first run) + feedback ---

(async () => {
  try {
    const { consent } = await window.launcher.telemetryGet();
    if (consent === null || consent === undefined) {
      document.getElementById('consent-overlay').classList.remove('hidden');
    }
  } catch {
    // never block startup on this
  }
})();

document.getElementById('consent-yes').addEventListener('click', async () => {
  await window.launcher.telemetrySetConsent(true);
  document.getElementById('consent-overlay').classList.add('hidden');
});
document.getElementById('consent-no').addEventListener('click', async () => {
  await window.launcher.telemetrySetConsent(false);
  document.getElementById('consent-overlay').classList.add('hidden');
});

const feedbackOverlay = document.getElementById('feedback-overlay');
document.getElementById('feedback-open').addEventListener('click', () => {
  document.getElementById('feedback-status').classList.add('hidden');
  feedbackOverlay.classList.remove('hidden');
});
document.getElementById('feedback-close').addEventListener('click', () => {
  feedbackOverlay.classList.add('hidden');
});
document.getElementById('feedback-send').addEventListener('click', async () => {
  const btn = document.getElementById('feedback-send');
  const statusEl = document.getElementById('feedback-status');
  statusEl.classList.remove('hidden');
  statusEl.style.color = '';
  btn.disabled = true;
  statusEl.textContent = 'Sending…';
  try {
    await window.launcher.feedbackSend({
      message: document.getElementById('feedback-text').value,
      contact: document.getElementById('feedback-contact').value,
    });
    statusEl.textContent = 'Sent — thank you!';
    document.getElementById('feedback-text').value = '';
    setTimeout(() => feedbackOverlay.classList.add('hidden'), 1200);
  } catch (err) {
    statusEl.textContent = cleanError(err);
    statusEl.style.color = '#ff6b6b';
  } finally {
    btn.disabled = false;
  }
});

// --- Library (games) ---

function badgeFor(game) {
  if (busy.has(game.id)) {
    const b = busy.get(game.id);
    const pct = Math.round(b.pct * 100);
    return `<span class="badge busy">${b.phase === 'downloading' ? `Downloading ${pct}%` : 'Installing…'}</span>`;
  }
  if (running.has(game.id)) return '<span class="badge running">Running</span>';
  const labels = {
    installed: 'Installed',
    available: 'Install',
    update: 'Update available',
    coming_soon: 'Coming soon',
  };
  return `<span class="badge ${game.status}">${labels[game.status] || game.status}</span>`;
}

// --- News hero (manifest-driven — post news by editing games.json on GitHub) ---

async function loadNews() {
  const hero = document.getElementById('news-hero');
  try {
    const news = await window.launcher.listNews();
    if (!news.length) { hero.classList.add('hidden'); return; }
    const n = news[0];
    hero.classList.remove('hidden');
    hero.style.backgroundImage = n.image ? `url('${n.image}')` : '';
    hero.innerHTML = `
      <div class="news-scrim"></div>
      <div class="news-content">
        <div class="news-kicker">News</div>
        <div class="news-title"></div>
        <div class="news-body"></div>
        ${n.url ? '<button class="btn btn-primary btn-small" id="news-more">Read more</button>' : ''}
      </div>
      ${news.length > 1 ? `<div class="news-chips">${news.slice(1, 4).map((m) => `<div class="news-chip" title=""></div>`).join('')}</div>` : ''}`;
    hero.querySelector('.news-title').textContent = n.title || '';
    hero.querySelector('.news-body').textContent = n.body || '';
    const chips = hero.querySelectorAll('.news-chip');
    news.slice(1, 4).forEach((m, i) => {
      if (chips[i]) {
        chips[i].textContent = m.title || '';
        if (m.url) chips[i].addEventListener('click', () => window.launcher.openExternal(m.url));
      }
    });
    const more = hero.querySelector('#news-more');
    if (more) more.addEventListener('click', () => window.launcher.openExternal(n.url));
  } catch {
    hero.classList.add('hidden');
  }
}

function fmtPlaytime(ms) {
  if (!ms || ms < 60000) return null;
  const h = ms / 3600000;
  return h >= 1 ? `${h.toFixed(1)} h` : `${Math.round(ms / 60000)} min`;
}

function renderGrid() {
  grid.innerHTML = '';
  const products = filesData.items || [];
  emptyState.classList.toggle('hidden', games.length + products.length > 0);
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
  // Downloadable products (3D part sets) sit in the same catalog as the games.
  for (const item of products) grid.appendChild(productCard(item));
}

// --- Products (3D file sets) in the library ---
// Cards are cached so the turntable keeps spinning across the frequent
// re-renders that download progress triggers.

const productCards = new Map(); // id -> { el, badge, thumb }

function coverUrlFor(item) {
  if (item.cover) return item.cover;
  const previews = item.previews ? Object.values(item.previews) : [];
  return previews[0] || null;
}

function mountThumb(el, url, opts) {
  if (window.mountPartThumb) return window.mountPartThumb(el, url, opts);
  // viewer.js is a module, so it may still be loading on first paint.
  const handle = {
    disposed: false,
    inner: null,
    dispose() {
      this.disposed = true;
      if (this.inner) this.inner.dispose();
    },
  };
  document.addEventListener(
    'viewer-ready',
    () => {
      if (!handle.disposed) handle.inner = window.mountPartThumb(el, url, opts);
    },
    { once: true }
  );
  return handle;
}

function productCard(item) {
  let entry = productCards.get(item.id);
  if (!entry) {
    const card = document.createElement('div');
    card.className = 'game-card product-card';
    card.innerHTML = `
      <div class="game-cover product-cover"><span class="cover-chip">3D files</span></div>
      <div class="game-info">
        <div class="game-title"></div>
        <span class="badge"></span>
      </div>`;
    card.querySelector('.game-title').textContent = item.title;
    card.addEventListener('click', () => openProduct(item.id));
    const url = coverUrlFor(item);
    entry = {
      el: card,
      badge: card.querySelector('.badge'),
      thumb: url ? mountThumb(card.querySelector('.product-cover'), url, { speed: 0.3 }) : null,
    };
    productCards.set(item.id, entry);
  }
  if (item.access) {
    const count = groupParts(item).length;
    entry.badge.className = 'badge available';
    entry.badge.textContent = `${count} part${count === 1 ? '' : 's'}`;
  } else {
    entry.badge.className = 'badge coming_soon';
    entry.badge.textContent = filesData.loggedIn ? 'No access' : 'Sign in to access';
  }
  return entry.el;
}

const productOverlay = document.getElementById('product-overlay');
let productThumb = null;

// --- Product media (build videos / posts) ---
// Videos open in a launcher-owned window (see media:play in main.js); posts go
// out to the browser, since Instagram cannot be embedded at all.

function mediaThumb(item) {
  if (item.thumb) return item.thumb;
  if (item.type === 'youtube') return `https://i.ytimg.com/vi/${item.id}/mqdefault.jpg`;
  return null;
}

function renderMedia(item) {
  const wrap = document.getElementById('product-media');
  const list = document.getElementById('product-media-list');
  list.innerHTML = '';

  // An entry with no link yet (e.g. a post whose URL we don't have) is skipped
  // rather than rendered as a dead card.
  const media = (item.media || []).filter(
    (m) => (m.type === 'youtube' && m.id) || (m.type !== 'youtube' && m.url)
  );
  wrap.classList.toggle('hidden', media.length === 0);
  if (!media.length) return;

  for (const entry of media) {
    const card = document.createElement('button');
    card.className = `media-card media-${entry.type}`;
    card.innerHTML = `
      <span class="media-shot"><span class="media-play">&#9654;</span></span>
      <span class="media-meta">
        <span class="media-title"></span>
        <span class="media-source"></span>
      </span>`;
    const shot = card.querySelector('.media-shot');
    const thumb = mediaThumb(entry);
    if (thumb) shot.style.backgroundImage = `url('${thumb}')`;
    card.querySelector('.media-title').textContent = entry.title || '';
    card.querySelector('.media-source').textContent =
      entry.type === 'youtube' ? 'YouTube' : 'Instagram';

    card.addEventListener('click', () => {
      if (entry.type !== 'youtube') {
        window.launcher.openExternal(entry.url);
        return;
      }
      list.querySelectorAll('.media-card').forEach((c) => c.classList.remove('playing'));
      card.classList.add('playing');
      window.launcher.playMedia({
        url: `https://www.youtube.com/watch?v=${entry.id}`,
        title: entry.title,
      });
    });

    list.appendChild(card);
  }
}

function clearMediaSelection() {
  document
    .querySelectorAll('#product-media-list .media-card.playing')
    .forEach((c) => c.classList.remove('playing'));
}

function openProduct(id) {
  const item = filesData.items.find((i) => i.id === id);
  if (!item) return;

  document.getElementById('product-title').textContent = item.title;

  const meta = [];
  if (item.version) meta.push(`v${item.version}`);
  if (item.access && item.assets.length) {
    const count = groupParts(item).length;
    meta.push(`${count} part${count === 1 ? '' : 's'}`);
    meta.push(formatColumns(item).join(' / '));
  }
  document.getElementById('product-meta').textContent = meta.join('  ·  ') || 'No release yet';
  document.getElementById('product-desc').textContent = item.description || '';

  renderMedia(item);

  const parts = document.getElementById('product-parts');
  parts.innerHTML = '<h3>Parts</h3>';
  parts.appendChild(buildPartsTable(item));

  const hero = document.getElementById('product-hero');
  if (productThumb) productThumb.dispose();
  productThumb = null;
  hero.innerHTML = '';
  const url = coverUrlFor(item);
  if (url) productThumb = mountThumb(hero, url, { speed: 0.25 });

  productOverlay.classList.remove('hidden');
}

function closeProduct() {
  clearMediaSelection();
  productOverlay.classList.add('hidden');
  if (productThumb) productThumb.dispose();
  productThumb = null;
  document.getElementById('product-hero').innerHTML = '';
}

document.getElementById('product-close').addEventListener('click', closeProduct);
productOverlay.addEventListener('click', (e) => {
  if (e.target === productOverlay) closeProduct();
});

function openDetail(id) {
  selectedId = id;
  renderDetail();
  const game = games.find((g) => g.id === id);
  if (game) loadDlc(game);
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

  // Playtime + last played.
  const playEl = document.getElementById('detail-playtime');
  const pt = fmtPlaytime(game.playMs);
  if (pt || game.lastPlayed) {
    const bits = [];
    if (pt) bits.push(`Played ${pt}`);
    if (game.lastPlayed) bits.push(`Last played ${new Date(game.lastPlayed).toLocaleDateString()}`);
    playEl.textContent = bits.join('  ·  ');
    playEl.classList.remove('hidden');
  } else {
    playEl.classList.add('hidden');
  }

  // Release notes from the game's GitHub release.
  const notesWrap = document.getElementById('detail-notes');
  if (game.latest && game.latest.notes && game.latest.notes.trim()) {
    notesWrap.classList.remove('hidden');
    document.getElementById('detail-notes-title').textContent = `What's new in v${game.latest.version}`;
    document.getElementById('detail-notes-body').textContent = game.latest.notes.trim();
  } else {
    notesWrap.classList.add('hidden');
  }

  const progressWrap = document.getElementById('detail-progress');
  const b = busy.get(game.id);
  if (b) {
    progressWrap.classList.remove('hidden');
    document.getElementById('detail-progress-fill').style.width = `${b.pct * 100}%`;
    let label = 'Installing…';
    if (b.phase === 'downloading') {
      label = `Downloading… ${Math.round(b.pct * 100)}%`;
      if (b.total) label += `  ·  ${fmtSize(b.pct * b.total)} / ${fmtSize(b.total)}`;
      if (b.bps > 0) label += `  ·  ${fmtSize(b.bps)}/s`;
    }
    document.getElementById('detail-progress-label').textContent = label;
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

  if (running.has(game.id)) {
    addBtn('Running', 'btn-play', () => {}, true);
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

// --- DLC ---

const dlcBusy = new Set();

async function loadDlc(game) {
  const wrap = document.getElementById('detail-dlc');
  const list = document.getElementById('dlc-list');
  if (!game.dlc || !game.dlc.length) { wrap.classList.add('hidden'); return; }
  wrap.classList.remove('hidden');
  list.innerHTML = '<div class="dlc-loading">Checking add-ons…</div>';
  let data;
  try {
    data = await window.launcher.dlcList(game.id);
  } catch {
    list.innerHTML = '<div class="dlc-loading">Could not load add-ons.</div>';
    return;
  }
  if (selectedId !== game.id) return; // user moved on
  list.innerHTML = '';
  for (const d of data.items) {
    const row = document.createElement('div');
    row.className = 'dlc-row';
    row.innerHTML = `
      <div class="dlc-meta">
        <div class="dlc-title"></div>
        <div class="dlc-desc"></div>
      </div>
      <div class="dlc-action"></div>`;
    row.querySelector('.dlc-title').textContent = d.title;
    row.querySelector('.dlc-desc').textContent = d.description || '';
    const action = row.querySelector('.dlc-action');

    const btn = document.createElement('button');
    btn.className = 'btn btn-small';
    if (dlcBusy.has(d.id)) {
      btn.className += ' btn-ghost';
      btn.textContent = 'Working…';
      btn.disabled = true;
    } else if (d.status === 'installed') {
      btn.className += ' btn-ghost';
      btn.textContent = '✓ Installed';
      btn.disabled = true;
    } else if (d.status === 'update') {
      btn.className += ' btn-primary';
      btn.textContent = 'Update';
      btn.addEventListener('click', () => installDlc(game, d, btn));
    } else if (d.status === 'available') {
      btn.className += ' btn-primary';
      btn.textContent = 'Install';
      btn.addEventListener('click', () => installDlc(game, d, btn));
    } else if (!data.loggedIn) {
      btn.className += ' btn-ghost';
      btn.textContent = 'Sign in to buy';
      btn.addEventListener('click', startLogin);
    } else {
      btn.className += ' btn-buy';
      btn.textContent = d.price ? `Buy ${d.price}` : 'Buy';
      btn.addEventListener('click', async () => {
        try {
          await window.launcher.dlcBuy({ buyUrl: d.buyUrl });
          action.innerHTML = '<button class="btn btn-small btn-ghost" id="dlc-paid-refresh">I\'ve paid — refresh</button>';
          action.querySelector('#dlc-paid-refresh').addEventListener('click', () => loadDlc(game));
        } catch (err) {
          showStatus(statusMessage, cleanError(err), true);
        }
      });
    }
    action.appendChild(btn);
    list.appendChild(row);
  }
}

async function installDlc(game, d, btn) {
  dlcBusy.add(d.id);
  btn.disabled = true;
  const progressId = `dlc:${d.id}`;
  fileProgressHandlers.set(progressId, (pct) => {
    btn.textContent = `Downloading ${Math.round(pct * 100)}%`;
  });
  try {
    await window.launcher.dlcInstall({ gameId: game.id, dlc: d });
  } catch (err) {
    showStatus(statusMessage, `DLC install failed: ${cleanError(err)}`, true);
  } finally {
    dlcBusy.delete(d.id);
    fileProgressHandlers.delete(progressId);
    loadDlc(game);
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

// A part is one physical thing that may ship in several formats (STEP, STL, …).
// Release assets are flat, so group them by filename stem: Towerv3.STEP and
// Towerv3.stl are one row with two download buttons, not two rows.
const FORMAT_ORDER = ['STEP', 'STL', '3MF', 'OBJ'];

function fileExt(name) {
  const m = /\.([^.]+)$/.exec(name);
  return m ? m[1].toUpperCase() : '';
}

function fileStem(name) {
  return name.replace(/\.[^.]+$/, '');
}

function groupParts(item) {
  const groups = new Map(); // lowercased stem -> group
  for (const asset of item.assets) {
    const stem = fileStem(asset.name);
    const key = stem.toLowerCase();
    if (!groups.has(key)) groups.set(key, { key, stem, formats: new Map() });
    groups.get(key).formats.set(fileExt(asset.name) || '?', asset);
  }
  return [...groups.values()];
}

// Formats present across the whole product, in a stable column order.
function formatColumns(item) {
  const seen = new Set(item.assets.map((a) => fileExt(a.name) || '?'));
  const known = FORMAT_ORDER.filter((f) => seen.has(f));
  const rest = [...seen].filter((f) => !FORMAT_ORDER.includes(f)).sort();
  return [...known, ...rest];
}

// Turn a CAD filename into something readable. The manifest can override any of
// these with a `parts` map, keyed by stem ({ "Towerv3": "Tower body" }) or by
// full filename.
function prettyPart(filename) {
  let n = filename
    .replace(/\.[^.]+$/, '')
    .replace(/^de[\s_-]?veldboom/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([a-uw-zA-UW-Z])(\d)/g, '$1 $2')
    .replace(/([a-z])v(\d)/gi, '$1 v$2')
    .trim();
  if (!n) n = filename;
  n = n
    .split(' ')
    .map((w) => (w.length > 1 && /^[A-Z0-9]+$/.test(w) ? w[0] + w.slice(1).toLowerCase() : w))
    .join(' ');
  return n[0].toUpperCase() + n.slice(1);
}

function partLabel(item, group) {
  const map = item.parts || {};
  if (map[group.stem]) return map[group.stem];
  for (const asset of group.formats.values()) {
    if (map[asset.name]) return map[asset.name];
  }
  return prettyPart(group.stem);
}

function partPreview(item, group) {
  const previews = item.previews || {};
  for (const asset of group.formats.values()) {
    if (previews[asset.name]) return previews[asset.name];
  }
  return previews[group.stem] || null;
}

async function downloadPart(asset) {
  const progressId = `file:${asset.id}`;
  const buttons = () => document.querySelectorAll(`[data-asset-btn="${asset.id}"]`);
  buttons().forEach((b) => { b.disabled = true; });
  fileProgressHandlers.set(progressId, (pct) => {
    buttons().forEach((b) => { b.textContent = `Downloading ${Math.round(pct * 100)}%`; });
  });
  try {
    const saved = await window.launcher.fileDownload({
      url: asset.url,
      name: asset.name,
      progressId,
    });
    buttons().forEach((b) => {
      b.innerHTML = saved ? '&#x2713; Downloaded' : '&#x2193; Download';
      b.disabled = !!saved;
    });
  } catch (err) {
    showStatus(document.getElementById('files-status'), `Download failed: ${cleanError(err)}`, true);
    buttons().forEach((b) => {
      b.innerHTML = '&#x2193; Download';
      b.disabled = false;
    });
  } finally {
    fileProgressHandlers.delete(progressId);
  }
}

// One aligned table of parts — used by both the Files page and the product
// detail overlay, so the two can never drift apart.
function buildPartsTable(item) {
  const wrap = document.createElement('div');
  wrap.className = 'parts-table';

  if (!item.access) {
    const locked = document.createElement('div');
    locked.className = 'parts-locked';
    if (filesData.loggedIn) {
      locked.textContent = '🔒 No access — contact Veldboom Studios';
    } else {
      locked.append('🔒 These files are private.');
      const btn = document.createElement('button');
      btn.className = 'btn btn-primary btn-small';
      btn.textContent = 'Sign in with GitHub';
      btn.addEventListener('click', startLogin);
      locked.appendChild(btn);
    }
    wrap.appendChild(locked);
    return wrap;
  }

  if (!item.assets.length) {
    const none = document.createElement('div');
    none.className = 'parts-locked';
    none.textContent = 'No files in the latest release.';
    wrap.appendChild(none);
    return wrap;
  }

  const columns = formatColumns(item);
  // Part name takes the slack; then the preview button, then one column per format.
  const template = `1fr 84px ${columns.map(() => '128px').join(' ')}`;

  const head = document.createElement('div');
  head.className = 'parts-head';
  head.style.gridTemplateColumns = template;
  head.innerHTML = `<span>Part</span><span></span>${columns
    .map(() => '<span class="col-format"></span>')
    .join('')}`;
  head.querySelectorAll('.col-format').forEach((el, i) => { el.textContent = columns[i]; });
  wrap.appendChild(head);

  for (const group of groupParts(item)) {
    const row = document.createElement('div');
    row.className = 'part-row';
    row.style.gridTemplateColumns = template;
    row.innerHTML = `
      <div class="part-name">
        <span class="part-label"></span>
        <span class="part-file"></span>
      </div>
      <div class="part-view"></div>`;
    const label = partLabel(item, group);
    row.querySelector('.part-label').textContent = label;
    row.querySelector('.part-file').textContent = group.stem;

    const previewUrl = partPreview(item, group);
    const view = document.createElement('button');
    view.className = 'btn btn-ghost btn-small btn-view';
    view.innerHTML = '&#x1f441; View';
    if (previewUrl) {
      view.addEventListener('click', () => window.openPartPreview(previewUrl, label));
    } else {
      view.disabled = true;
      view.title = 'No 3D preview for this part';
    }
    row.querySelector('.part-view').appendChild(view);

    for (const format of columns) {
      const cell = document.createElement('div');
      cell.className = 'part-format';
      const asset = group.formats.get(format);
      if (asset) {
        const dl = document.createElement('button');
        dl.className = 'btn btn-primary btn-small btn-dl';
        dl.dataset.assetBtn = asset.id;
        dl.title = `Download ${asset.name}`;
        dl.innerHTML = `&#x2193; ${asset.size ? fmtSize(asset.size) : format}`;
        dl.addEventListener('click', () => downloadPart(asset));
        cell.appendChild(dl);
      } else {
        cell.innerHTML = '<span class="part-missing">—</span>';
      }
      row.appendChild(cell);
    }

    wrap.appendChild(row);
  }
  return wrap;
}

function renderFiles() {
  const list = document.getElementById('files-list');
  const empty = document.getElementById('files-empty');
  list.innerHTML = '';
  empty.classList.toggle('hidden', filesData.items.length > 0);

  for (const item of filesData.items) {
    const panel = document.createElement('section');
    panel.className = 'file-panel';
    panel.innerHTML = `
      <header class="file-panel-head">
        <div class="file-meta">
          <div class="file-title"></div>
          <div class="file-desc"></div>
        </div>
        <div class="file-tags"></div>
      </header>`;
    panel.querySelector('.file-title').textContent = item.title;
    panel.querySelector('.file-desc').textContent = item.description || '';

    const tags = panel.querySelector('.file-tags');
    const tag = (text) => {
      const el = document.createElement('span');
      el.className = 'file-tag';
      el.textContent = text;
      tags.appendChild(el);
    };
    if (item.version) tag(`v${item.version}`);
    if (item.access && item.assets.length) {
      const count = groupParts(item).length;
      tag(`${count} part${count === 1 ? '' : 's'}`);
      tag(formatColumns(item).join(' / '));
    }

    panel.appendChild(buildPartsTable(item));
    list.appendChild(panel);
  }
}

const fileProgressHandlers = new Map();

async function loadFiles() {
  try {
    document.getElementById('files-status').classList.add('hidden');
    filesData = await window.launcher.filesList();
    renderFiles();
    renderGrid(); // products show up in the library too
  } catch (err) {
    showStatus(document.getElementById('files-status'), 'Could not load files list.', true);
  }
}

// --- Global progress events ---

window.launcher.onProgress(({ id, phase, pct, total, bps }) => {
  const fileHandler = fileProgressHandlers.get(id);
  if (fileHandler) {
    if (phase === 'downloading') fileHandler(pct);
    return;
  }
  if (phase === 'done') {
    busy.delete(id);
  } else {
    busy.set(id, { phase, pct, total, bps });
  }
  renderGrid();
  if (selectedId === id) renderDetail();
});

window.launcher.onRunning(({ id, running: isRunning }) => {
  if (isRunning) running.add(id);
  else running.delete(id);
  renderGrid();
  if (selectedId === id) renderDetail();
  if (!isRunning) loadGames(); // refresh playtime after a session
});

// --- Wire up ---

document.getElementById('refresh-btn').addEventListener('click', () => { loadGames(); loadNews(); });
document.getElementById('files-refresh-btn').addEventListener('click', loadFiles);
document.getElementById('detail-close').addEventListener('click', closeDetail);
overlay.addEventListener('click', (e) => {
  if (e.target === overlay) closeDetail();
});

window.launcher.version().then((v) => {
  document.getElementById('launcher-version').textContent = `Launcher v${v}`;
});

const updateBanner = document.getElementById('update-banner');
const updateLabel = document.getElementById('update-banner-label');
const updateBar = updateBanner.querySelector('.update-banner-bar');
const updateFill = document.getElementById('update-banner-fill');
const updateRestartBtn = document.getElementById('update-restart-btn');

window.launcher.onUpdaterStatus((data) => {
  if (data.state === 'hidden') {
    updateBanner.classList.add('hidden');
    return;
  }
  updateBanner.classList.remove('hidden');
  if (data.state === 'downloading') {
    updateLabel.textContent = data.version
      ? `Downloading update v${data.version}…`
      : updateLabel.textContent;
    if (typeof data.pct === 'number') {
      updateBar.classList.remove('hidden');
      updateFill.style.width = `${Math.round(data.pct)}%`;
    }
    updateRestartBtn.classList.add('hidden');
  } else if (data.state === 'ready') {
    updateLabel.textContent = `Update v${data.version} ready`;
    updateBar.classList.add('hidden');
    updateRestartBtn.classList.remove('hidden');
  }
});

updateRestartBtn.addEventListener('click', () => {
  updateRestartBtn.disabled = true;
  window.launcher.updaterInstall();
});

window.launcher.authStatus().then((u) => {
  user = u;
  renderUser();
});

renderUser();
loadGames();
loadNews();
loadFiles(); // products are part of the library, so load them at start
