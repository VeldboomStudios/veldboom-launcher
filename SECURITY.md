# Security — Veldboom Launcher

## Reporting a vulnerability

Email **shaquilleveldboom@gmail.com** with "Veldboom Launcher security" in the subject.
Please do not open a public issue for anything exploitable. Expect a first reply within
a few working days.

## How the launcher is built

- The renderer runs with `contextIsolation: true` and `nodeIntegration: false`; it
  reaches the main process only through the fixed IPC surface in `src/preload.js`.
- A CSP in `index.html` restricts what the renderer may load.
- `open:external` and `media:play` validate URLs before handing them to the shell —
  `media:play` accepts only `https://www.youtube.com/watch?v=<id>`.
- The sign-in token is encrypted at rest with Windows DPAPI via Electron `safeStorage`.
- There is no telemetry, no analytics and no Veldboom-operated server.

## Known limitations

### 1. The installer is unsigned

Windows SmartScreen warns on first run ("Windows protected your PC" → **More info** →
**Run anyway**). Code signing (~€300+/yr) would remove this. Until then, **only download
the launcher from the official releases page**:
<https://github.com/VeldboomStudios/veldboom-launcher/releases>

### 2. The legacy OAuth App grant is over-broad — being replaced

**Status: mitigation in progress.**

The launcher's original sign-in is a GitHub **OAuth App** requesting the `repo` scope.
GitHub has no read-only private-repo scope for OAuth Apps, so `repo` was the only way to
read release assets from private repos — but it grants **read and write access to every
repository the signed-in user can see**. The launcher only ever reads releases, yet the
token it holds could do far more if it were ever extracted from a user's machine.

**The fix**, implemented in `src/main.js`, is a **GitHub App** instead. A GitHub App
user-to-server token can only reach the intersection of:

- repositories the app installation covers (Veldboom Studios content repos only), and
- repositories the signed-in user already has access to,

limited further by the app's registered permissions (**Contents: read-only**). Such a
token **cannot touch the user's own repositories at all**.

The launcher prefers the GitHub App whenever `githubAppClientId` is set in `games.json`,
and falls back to the legacy OAuth App only while that field is empty. The sign-in screen
states plainly which grant is in use and warns on the legacy path.

**To complete the migration, see "Sign-in setup" in [README.md](README.md).**

### 3. GitHub App user tokens must not expire

A GitHub App created today has *user-to-server token expiration* on by default: tokens
last 8 hours and are renewed with a refresh token. Renewal requires the app's
**client secret** — which a desktop application cannot hold, since anything shipped in
the installer is readable by anyone who has it.

So the launcher does **not** implement refresh, and expiry must be turned off in the app
registration (**Optional Features → User-to-server token expiration → Opt-out**). If it
is left on, the launcher detects the `expires_in` field, stores the expiry, and cleanly
drops the token once it passes so the user is asked to sign in again instead of hitting
silent API failures.

### 4. Add-on invitations are not auto-accepted under the GitHub App

Entitlements are GitHub repository collaborator invitations. The launcher's
`acceptPendingInvites()` used to accept them automatically, which the `repo` scope
allowed. Under the GitHub App, `/user/repository_invitations` sits behind the
**Administration** permission, which the launcher deliberately does **not** request —
accepting an invitation is not worth holding a permission that can also reconfigure or
delete repositories.

The call remains as best-effort and returns `0` when the permission is absent. Buyers
accept the invitation from GitHub's own email or notifications instead — one extra click,
and no dangerous permission in the app.

### 5. Games run with your user's privileges

Installed games are ordinary executables launched by the launcher and are not sandboxed.
Only install games from catalogs you trust; the default catalog is Veldboom Studios'.
