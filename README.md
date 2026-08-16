# Veldboom Launcher

Desktop game launcher for Veldboom Studios — Epic-style library that installs, updates and launches games straight from GitHub releases. The launcher itself auto-updates from this repo's releases.

## How it works

- **Game catalog** = [`games.json`](games.json) in this repo (`main` branch). The launcher fetches it live, so adding a game to the catalog needs **no launcher update**.
- **Each game** lives in its own GitHub repo. A game version = a GitHub **release** on that repo with a **.zip asset** containing the game build.
- The launcher compares the installed version against the latest release tag → shows Install / Update / Play.
- **Launcher updates**: push a tag `v*` here → GitHub Actions builds the Windows installer and publishes a release → installed launchers auto-update via `electron-updater`.

## Publishing a game (per release)

1. Build your game (e.g. UE5 packaged build) and zip it. The zip must contain the game's `.exe` (top-level folder inside the zip is fine — the launcher finds it).
2. Create the game repo once: `gh repo create VeldboomStudios/<game-id> --public`
3. Publish a release:
   ```
   gh release create v1.0.0 MyGame.zip --repo VeldboomStudios/<game-id> --title "v1.0.0" --notes "First release"
   ```
4. For updates, repeat with a higher tag (`v1.0.1`, `v1.1.0`, …). Players see an **Update** button automatically.

> Game repos must be **public** so players can download without a GitHub account. If a game repo must stay private, keep the code private and make a separate public `<game-id>-releases` repo that only holds the release zips.

## Adding a game to the catalog

Edit `games.json` on `main` and push:

```json
{
  "id": "spiral-racer",
  "title": "Spiral Racer",
  "description": "Short pitch shown in the launcher.",
  "image": "https://raw.githubusercontent.com/VeldboomStudios/spiral-racer/main/cover.jpg",
  "repo": "VeldboomStudios/spiral-racer",
  "exe": "SpiralRacer.exe"
}
```

- `image`: portrait cover (3:4 looks best). Host it in the game repo and use the raw URL.
- `exe`: the executable filename inside the zip.

## Releasing a launcher update

```
npm version patch        # bumps package.json + creates git tag
git push && git push --tags
```

GitHub Actions builds `VeldboomLauncher-Setup.exe` and attaches it to the release. Installed launchers pick it up automatically on next start.

## Sign-in & gated files

The launcher has "Sign in with GitHub" (OAuth device flow — no passwords, no server). Signed-in users can access **gated files**: release assets from **private** repos listed in the `files` section of `games.json`.

Access control = GitHub repo permissions:

1. Create a private repo, e.g. `VeldboomStudios/beta-builds` and publish releases with assets on it.
2. Add it to `games.json` under `"files"`:
   ```json
   { "id": "beta", "title": "Beta Builds", "description": "Early access builds", "repo": "VeldboomStudios/beta-builds" }
   ```
3. Grant someone access: `gh api -X PUT repos/VeldboomStudios/beta-builds/collaborators/<their-github-username> -f permission=pull`
   (or repo Settings → Collaborators → Add people). Revoke = remove collaborator.

Users without access see the item locked; users with access get download buttons in the launcher's **Files** tab.

Tokens are stored encrypted on the user's machine (Windows DPAPI via Electron safeStorage).

### Sign-in setup (GitHub App)

The launcher signs in with a **GitHub App**, whose token can only read Veldboom repos the
user already has access to — it can never touch the user's own repositories. Set it up
once:

1. **Create the app** — <https://github.com/settings/apps/new> (Settings → Developer settings
   → GitHub Apps → **New GitHub App**). Note `VeldboomStudios` is a **personal account, not
   an organisation**, so this lives under your own settings — the `/organizations/…` URL 404s.
   - Homepage URL: the repo URL is fine. Leave the webhook **inactive**.
   - **Permissions → Repository → Contents: Read-only.** Nothing else.
     (Do *not* grant `Administration` — see [SECURITY.md](SECURITY.md) §4.)
   - **Where can this app be installed?** Only on this account.
2. **Enable the device flow** — in the app's settings, tick **Enable Device Flow**.
   The launcher has no browser redirect, so this is required.
3. **Turn off token expiry** — app settings → **Optional Features** →
   **User-to-server token expiration** → **Opt-out**. This is not optional for us:
   refreshing an expiring token needs the app's client secret, which a desktop app
   cannot ship. Leave it on and users get signed out every 8 hours.
4. **Install the app** on the `VeldboomStudios` account and grant it the content repos —
   the game repos, `veldboom-tower-files`, and any future DLC repos.
5. **Publish the Client ID** — copy the app's Client ID (starts `Iv23...`) into
   `games.json`:
   ```json
   { "githubAppClientId": "Iv23liXXXXXXXXXXXX" }
   ```
   Push `games.json` to `main`. Launchers pick it up on next start — no launcher release
   needed.

Until step 5 is done, `githubAppClientId` stays `""` and the launcher falls back to the
**legacy OAuth App** in `githubClientId`, which needs the `repo` scope (read *and write*
on every repo the user can see). The sign-in screen warns the user when that fallback is
active. Once the GitHub App is live, everyone signs in again once, and the old OAuth App
can be deleted along with the `githubClientId` field.

Access control is unchanged either way: a user reaches a gated repo only if they are a
collaborator on it. One behaviour does change — pending invitations are no longer
auto-accepted, so buyers accept the invite from GitHub's email or notifications. See
[SECURITY.md](SECURITY.md) §4.

## Privacy & security

- [`PRIVACY.md`](PRIVACY.md) — what is stored (all of it local), what reaches GitHub and
  Google, and what is never collected. Surfaced in-app under **Privacy & data**, which
  also has a working **Delete my data** button.
- [`SECURITY.md`](SECURITY.md) — reporting vulnerabilities and the known limitations.

Both are linked from inside the launcher, so keep them on `main`.

## Website download link

Always points to the newest installer:

```
https://github.com/VeldboomStudios/veldboom-launcher/releases/latest/download/VeldboomLauncher-Setup.exe
```

See [`website-snippet.html`](website-snippet.html) for a ready-made download button.

## Local development

```
npm install
npm start          # run the launcher in dev mode
npm run build      # build installer locally into dist/
```

## Notes

- The installer is unsigned, so Windows SmartScreen shows a "Windows protected your PC" warning — users click **More info → Run anyway**. A code-signing certificate removes this (~€300+/yr); optional later.
- GitHub API rate limit for anonymous users is 60 requests/hour/IP — fine for a personal catalog (1 request per game per refresh).
- Installed games live in `%APPDATA%/veldboom-launcher/games/`.
