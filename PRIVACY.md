# Privacy Policy — Veldboom Launcher

**Last updated:** 16 August 2026

This policy covers the **Veldboom Launcher** desktop application. Games installed through
the launcher are separate programs and may have their own policies.

## Who is responsible

**Veldboom Studios**, Amsterdam, the Netherlands — the controller for the limited
processing described below. Questions or requests: **shaquilleveldboom@gmail.com**.

Because Veldboom Studios is established in the EU, this policy follows the **GDPR**.

## The short version

The launcher has **no server**. Veldboom Studios operates no backend, no account
database and no analytics, and therefore **receives no personal data about you from the
launcher at all**. Everything the launcher knows about you is stored on your own
computer, and you can erase it from inside the app at any time.

What follows explains the parts where that is not the whole story — namely GitHub, which
hosts the downloads and the sign-in.

## What the launcher stores on your computer

All of this lives under `%APPDATA%/veldboom-launcher/` and never leaves your machine:

| Data | Where | Why |
|---|---|---|
| GitHub sign-in token | `auth.bin`, encrypted with Windows DPAPI via Electron `safeStorage` | So you stay signed in and can download files you have access to |
| Installed games, versions, install paths | `installed.json` | So the launcher knows what is installed and when to offer updates |
| Playtime and last-played timestamp | `installed.json` | Shown to you in the launcher. Never transmitted |
| Downloaded game files | `games/` | The games themselves |
| `veldboom_session.json` | Inside each game folder | Written at launch so the game knows which account is playing and which add-ons are owned. Read by the game on your machine |

You can delete all of it: **Privacy & data → Delete my data** in the launcher sidebar.
That signs you out and removes the token, the install records, the playtime and the
installed game files.

## What leaves your computer, and to whom

The launcher does not send anything to Veldboom Studios. It does talk to two third
parties, which necessarily see your **IP address** because that is how the internet
works:

### GitHub, Inc.

GitHub hosts the catalog, every game and file download, the launcher's own updates, and
the sign-in. GitHub receives:

- Your **IP address** and a `VeldboomLauncher` user agent whenever the launcher fetches
  the catalog, checks for releases or downloads a file — this happens whether or not you
  are signed in.
- Once you sign in, your **GitHub identity** (username, display name, avatar) and the
  API requests made with your token.

GitHub processes this under its own
[privacy statement](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement).
The launcher reads your GitHub username, display name and avatar only to show who is
signed in and to check which Veldboom repositories you may download from.

### Google (YouTube)

Only if a product page shows a video. YouTube thumbnails load from `i.ytimg.com`, and
opening a video loads `youtube.com` in a launcher window. Google then receives your IP
address and any YouTube cookies, exactly as visiting YouTube in a browser would.
See [Google's privacy policy](https://policies.google.com/privacy).

If you never open a product video, this does not happen.

### Payments (add-ons)

The launcher does not process payments. If you buy an add-on, it opens the store page in
your normal browser and passes your **GitHub username** so the purchase can be linked to
your account. The payment itself, including all card details, happens at the payment
provider — the launcher never sees or stores payment data.

## What the launcher does *not* do

- **No analytics, telemetry, crash reporting or usage tracking.** None. There is no
  code in the launcher that reports anything about your use of it.
- **No advertising, no profiling, no automated decision-making, no selling of data.**
- **No AI.** The launcher contains no AI features and sends nothing to any AI service.
- **No access to your files** beyond its own folder and the games it installs.

## What signing in grants

Signing in is **optional**. Public games install and play without it. Sign-in exists so
you can download files and add-ons that are restricted to specific people.

The launcher shows you the exact grant before you sign in. With the **GitHub App**
sign-in, the token can only read Veldboom Studios repositories you already have access
to, and **cannot read, write or delete your own repositories**.

> **Transition note.** Until the GitHub App is live, the launcher falls back to an older
> OAuth App sign-in that requests GitHub's `repo` scope — which grants read *and write*
> access to every repository your account can see. That is far more than the launcher
> needs or uses, and it is why the app is being migrated. The sign-in screen warns you
> when this legacy path is in use. See [SECURITY.md](SECURITY.md).

## Legal bases (GDPR art. 6)

- **Contract (art. 6(1)(b))** — storing your token, your installed games and your
  entitlements is necessary to provide the launcher you asked for.
- **Legitimate interest (art. 6(1)(f))** — contacting GitHub to fetch the catalog and
  updates, which is the only way to deliver the software.

No processing here relies on consent, because nothing optional is collected. Opening a
YouTube video is your own action, and Google asks for its own cookie consent when it
happens.

## Retention

Data stays on your computer until you delete it — via **Delete my data**, by signing
out (token only), by uninstalling a game, or by removing
`%APPDATA%/veldboom-launcher/`. Veldboom Studios holds nothing to retain.

## Your rights

Under the GDPR you have the right of access, rectification, erasure, restriction,
objection and data portability. For launcher data these are exercised directly on your
own machine: everything is in `%APPDATA%/veldboom-launcher/` in plain JSON (except the
encrypted token), and **Delete my data** erases it.

For the data GitHub or Google hold about you, contact them — they are the controllers
for their own processing.

You may also lodge a complaint with the Dutch DPA, the
[Autoriteit Persoonsgegevens](https://autoriteitpersoonsgegevens.nl).

## Children

The launcher is not directed at children under 13 and collects nothing from them. A
GitHub account is required to sign in, and GitHub sets its own age requirements.

## Changes

Changes are published in this file in the launcher's public repository, with the date at
the top updated. Material changes will be noted in the launcher's news feed.
