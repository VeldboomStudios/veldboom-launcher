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
