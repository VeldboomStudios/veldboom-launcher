# De Veldboom — open release + catalog v2

**Date:** 2026-08-04
**Scope:** P1 (open-source the Veldboom Tower) and P2 (catalog v2 + launcher support for downloadable assets)
**Status:** design, awaiting review

---

## 1. Why

The Veldboom Launcher has working plumbing — GitHub OAuth sign-in, private-repo gating via
collaborator invites, split-zip downloads, self-update — and exactly one thing plugged into it
(GODSpeed). Download telemetry to 22 juli 2026: ~11 events, ~5 real humans, **0 sign-ins**.

The launcher is not short of features. It is short of reasons to open it.

De Veldboom — the modular 3D-printed vertical farming tower that gave the studio its name
(*veldboom* = field tree) — becomes the first non-game thing the platform carries, and the first
entry that requires no account at all.

## 2. Decisions (locked)

| Decision | Choice |
|---|---|
| Platform shape | One catalog, two front doors (desktop launcher + web gallery). **Web front door is P3, not this spec.** |
| Content kinds | `game`, `experience`, `film`, `asset` |
| Auth | GitHub sign-in retained for gated content |
| Tower licence | **CC BY 4.0** — print, modify, sell, attribution required; sharing back is requested, not compelled |
| Primary print size | **Bambu Lab 256 mm** — the large-format 420 mm version is secondary |
| Tower access | `public` — no sign-in |

### Accepted trade-offs

- CC BY on functional mechanical geometry is weakly enforceable; combined with permissive terms this
  is effectively near-public-domain. Others may print and sell Veldboom Towers. Accepted deliberately.
- GitHub sign-in does not fit non-developer audiences (clients, museums, general viewers). Accepted
  for now; it does not block this spec because the tower is `public`.

---

## 3. P1 — `VeldboomStudios/veldboom-tower`

Public repo. Ships independently of the launcher.

### 3.1 Structure

```
veldboom-tower/
  LICENSE                    CC BY 4.0 full text
  README.md
  TRADEMARK.md
  source/step/               master CAD, both sizes
  print/
    bambu-256/               STL + 3MF   ← default download
    large-420/               STL + 3MF   ← Neptune 4 Max and other large beds
  profiles/
    bambu/                   Bambu Studio .3mf project — plates, supports, settings baked in
    neptune4max/             Cura profile, PETG 0.8 mm
  docs/
    assembly.md
    bom.md
    photos/
  gallery/README.md          how to add your build
  .github/ISSUE_TEMPLATE/show-your-build.yml
```

### 3.2 Two print sizes

Bambu-sized modules lead everywhere — README, launcher card, download button. Most people who would
print this own a 256 mm machine, not a 420 mm one. The large-format variant is offered second.

For Bambu the deliverable is a **`.3mf` Bambu Studio project**, not a settings file: plate layout,
supports and print settings travel inside it, so the user opens and prints. This is the equivalent of
what the Cura profile does for the Neptune 4 Max, and it is the single biggest factor in whether a
download becomes a finished tower.

### 3.3 Trademark

The Veldboom triple-infinity logo is embossed into every planter module. CC BY licenses the *design*;
it does not license the *mark*. Two mitigations, both applied:

1. `TRADEMARK.md` and a README section: the design is CC BY 4.0; the Veldboom Studios name and logo
   are not licensed. Remove the emboss on derivatives you distribute.
2. Ship a **logo-free module variant** in `source/step/` and `print/`, so remixers have a clean base.

### 3.4 README outline

1. Hero image (planted crop) and one-line description
2. What it is, and why it is open
3. **Print it** — Bambu first, then large format; profiles; filament (PETG); expected print time
4. **Assemble it** — link to `docs/assembly.md` and the assembly video
5. **Modify it** — STEP source, logo-free variant, what the modules must preserve to stay stackable
6. **Share what you build** — issue template, Discussions, gallery; featured builds appear in the launcher
7. Licence and trademark
8. Links (§3.6)

### 3.5 Share-back mechanism

CC BY does not compel sharing, so the design must invite it:

- `show-your-build` issue template
- GitHub Discussions enabled
- Pull requests welcomed for design improvements
- **Featured community builds are surfaced in the launcher and web gallery.** Being shown on the
  platform is a stronger incentive for a maker than any licence clause, and costs a `community`
  section in the catalog rather than legal machinery.

### 3.6 Links to include

Channel: <https://www.youtube.com/@veldboomstudios>

| Video | Use |
|---|---|
| [3D printing my own vertical farming tower](https://www.youtube.com/watch?v=VNa64YbC-ds) (29 aug 2024) | Primary — the making-of. README and catalog entry |
| [Shop clip, 23 s](https://www.youtube.com/watch?v=IH_tON4NkcE) | Secondary — short product clip |
| [Studio tour, tower nearing completion](https://www.youtube.com/watch?v=xfJIsFiobo4) | Context |
| [Studio soft launch](https://www.youtube.com/watch?v=SJiJa1gDq1w) | Context |

Also: <https://veldboomstudios.com> · <https://www.instagram.com/veldboomstudios/>

**No assembly video exists yet.** `docs/assembly.md` carries written steps at v1.0.0 and the video
link is added when filmed (§3.8). The README links the making-of video, which is not a how-to, and
must not be labelled as one.

### 3.7 Release artefacts

Tag `v1.0.0`, GitHub release with:

- `veldboom-tower-bambu-256.zip` — print-ready STL + 3MF + Bambu Studio project
- `veldboom-tower-large-420.zip` — print-ready STL + 3MF + Cura profile
- `veldboom-tower-source-step.zip` — STEP, both sizes, including logo-free variant

The launcher downloads release assets, so these zips are what the catalog entry points at. Source
also remains browsable in the repo tree.

### 3.8 Asset production — office PC / studio session

CAD lives on the office PC; none of this can be produced on the laptop.

**Export**
- [ ] STEP, all modules, both sizes
- [ ] STL + 3MF, Bambu 256 mm
- [ ] STL + 3MF, large format 420 mm
- [ ] Logo-free module variant, STEP + STL
- [ ] Bambu Studio `.3mf` project with plates and settings
- [ ] Cura profile export, Neptune 4 Max PETG 0.8 mm

**Photography** (current library is one portfolio photo)
- [ ] Full tower, straight on, plain background
- [ ] Single module, front and three-quarter
- [ ] All parts laid out flat, exploded
- [ ] Planted close-up *(exists — `veldboom-portfolio/assets/towers.jpg`)*
- [ ] Scale shot, tower beside a person

**Video**
- [ ] Assembly / instruction manual — does not exist, must be filmed

### 3.9 Also publish to MakerWorld

One upload, links back to the repo for STEP source. MakerWorld is where Bambu owners browse; GitHub
reaches developers. Recommended, not blocking.

---

## 4. P2 — catalog v2 + launcher

### 4.1 Backwards compatibility (constraint, not preference)

Launchers already installed fetch
`https://raw.githubusercontent.com/VeldboomStudios/veldboom-launcher/main/games.json` and read
`games[]`, `files[]`, `news[]`.

Therefore:

- **The filename stays `games.json`.** Renaming it to `catalog.json` breaks every installed client.
- New content goes in a new top-level `items[]` array. Old clients ignore unknown keys and keep working.
- New clients prefer `items[]`, falling back to `games[]` + `files[]` when absent.
- **The tower must not be added to `games[]`.** Old clients would render an Install button and fail.

### 4.2 Schema

```jsonc
{
  "githubClientId": "…",
  "news": [ … ],          // unchanged
  "games": [ … ],         // legacy, retained for installed clients
  "files": [ … ],         // legacy, retained
  "items": [
    {
      "id": "veldboom-tower",
      "kind": "asset",                    // game | experience | film | asset
      "access": "public",                 // public | signin | paid
      "title": "De Veldboom — Vertical Farming Tower",
      "description": "…",
      "image": "https://raw.githubusercontent.com/…/tower-hero.jpg",
      "tags": ["open source", "3d printing", "vertical farming"],
      "links": {                          // display links, opened in the browser
        "source": "https://github.com/VeldboomStudios/veldboom-tower",
        "video": "https://www.youtube.com/watch?v=VNa64YbC-ds",
        "channel": "https://www.youtube.com/@veldboomstudios"
      },
      "repo": "VeldboomStudios/veldboom-tower",   // owner/name, used for the release API
      "assets": [
        { "name": "veldboom-tower-bambu-256.zip", "label": "Bambu Lab (256 mm) — recommended" },
        { "name": "veldboom-tower-large-420.zip", "label": "Large format (420 mm)" },
        { "name": "veldboom-tower-source-step.zip", "label": "STEP source" }
      ]
    }
  ]
}
```

Kind-specific fields: `game` keeps `repo` + `exe`; `experience` uses `url`; `film` uses `videoId`;
`asset` uses `repo` + `assets[]`.

### 4.3 Launcher changes

`src/main.js`
- `getManifest()` normalises legacy `games[]`/`files[]` into `items[]` so the renderer handles one shape
- New IPC `assetDownload(itemId, assetName)`
- **Download path depends on `access`:** `public` fetches `browser_download_url` unauthenticated;
  `signin`/`paid` use the existing authenticated API asset endpoint
- Keep the `VELDBOOM_CATALOG` environment override added during design — it is how any catalog change
  gets previewed locally before going public

`src/renderer/app.js`
- Render `kind: asset` cards with a Download button per entry in `assets[]`
- **`access: public` never shows the lock and never prompts sign-in**
- Existing game cards and the files view unchanged

`package.json`
- Version → `1.5.0`

### 4.4 Version reconciliation (blocking)

This working copy is at `1.3.1`, newest local tag `v1.3.1`. Records indicate **v1.4.0** (in-app update
banner) shipped 17 juli 2026, and there is no installed build on this machine — so the release was
almost certainly cut from the office PC and never pushed back.

**Reconcile before tagging 1.5.0**, or the release silently drops the update banner.

### 4.5 GODSpeed entry upgrade

Catalog work, so it ships with P2.

#### Problem

`assets/godspeed-hero.png` is **192 × 192** — an icon. The launcher stretches it across the card
cover and the news-hero background. It is the reason the only game in the catalog looks unfinished.
No other GODSpeed imagery exists in the repo; the three Eline files in `veldboom-portfolio/assets/`
are 512 × 288 video thumbnails.

#### Imagery

Interim art is extracted from the studio's own *Bunker Mansion* cinematic
([`_mQJRngtzr4`](https://www.youtube.com/watch?v=_mQJRngtzr4), UE 5.8, Movie Render Queue).

| Slot | Frame | Why |
|---|---|---|
| Hero | Island aerial — estate on the cliff, sea, racing kerbs on the road | Only frame that still reads at card size, and states the premise in one glance |
| Second | Terrace at dusk, orange car, lit columns | Best colour and depth; too generic as the lead |
| Third | Villa cross-section, garage level, **"VERTICAL FARM"** signage in shot | Ties GODSpeed to the tower — same solarpunk idea, no explanation needed |

Prepared at 1920 × 1080 in the session scratchpad. **These are interim.** They come from a compressed
1440p stream and carry visible artefacts in the dusk gradients. Replace with native 4K stills rendered
straight from Unreal (§4.5 production list).

#### Videos to surface

| Video | Role |
|---|---|
| [Bunker Mansion — 4K Cinematic](https://www.youtube.com/watch?v=_mQJRngtzr4) (29 jul 2026) | Primary. Already links back to the launcher |
| [Official Game Release trailer](https://www.youtube.com/watch?v=vidL410Ugbk) (10 jun 2024) | Trailer |
| [V0.02 Third-person game mode](https://www.youtube.com/watch?v=5pCwyDUaoVI) (23 jul 2024) | Actual gameplay |

Channel: <https://www.youtube.com/@veldboomstudios>

**Deliberately excluded** — the 2022 Isle of Eline videos
([`ZSeFW-OqUL8`](https://www.youtube.com/watch?v=ZSeFW-OqUL8),
[`5sG3zXgHaEI`](https://www.youtube.com/watch?v=5sG3zXgHaEI),
[`LhCFq0-hYYU`](https://www.youtube.com/watch?v=LhCFq0-hYYU),
[`LplAtjT3uaA`](https://www.youtube.com/watch?v=LplAtjT3uaA)). They are branded *NFT Metaverse* and
tagged `nft` / `metaverse`. `ZSeFW-OqUL8` is the channel's best-performing Eline video (406 views,
22 likes), but surfacing that framing to a new player contradicts GODSpeed's current positioning as a
solarpunk racing life-sim. Excluded from the launcher; they remain on the channel.

**Unresolved:** [`2UPK2WBOfH0`](https://www.youtube.com/watch?v=2UPK2WBOfH0) is public with the title
"17 July 2026", no description, no tags, 2m28s, 121 views. Not linked until it is either titled
properly or unlisted. Contents unknown from metadata alone.

#### Naming — needs a decision

The catalog says `GODSpeed`, the executable is `Isle_Of_Eline.exe`, and every video says *Isle of
Eline*. Anyone arriving from YouTube searches for Eline and finds GODSpeed.

Recommendation: **GODSpeed is the game, the Isle of Eline is the place it happens.** Title the entry
`GODSpeed`, subtitle it *"on the Isle of Eline"*, and keep Eline in tags and video titles so search
still lands. Requires sign-off before the catalog entry is written.

#### Catalog entry

```jsonc
{
  "id": "godspeed",
  "kind": "game",
  "access": "signin",
  "title": "GODSpeed",
  "subtitle": "on the Isle of Eline",
  "image": "https://raw.githubusercontent.com/…/assets/godspeed-hero.jpg",
  "gallery": ["…/godspeed-terrace.jpg", "…/godspeed-garage.jpg"],
  "links": {
    "video": "https://www.youtube.com/watch?v=_mQJRngtzr4",
    "trailer": "https://www.youtube.com/watch?v=vidL410Ugbk",
    "gameplay": "https://www.youtube.com/watch?v=5pCwyDUaoVI",
    "channel": "https://www.youtube.com/@veldboomstudios"
  },
  "repo": "VeldboomStudios/godspeed-releases",
  "exe": "Isle_Of_Eline.exe"
}
```

`gallery[]` is new and renders only in the detail view. Old clients ignore it.

#### Production list — office PC

- [ ] Native 4K stills from Unreal, no video compression: island aerial (hero), terrace/car, garage
      with vertical-farm signage
- [ ] Decide Eline vs GODSpeed naming
- [ ] Title or unlist `2UPK2WBOfH0`

### 4.6 Out of scope

Web front door (P3); `experience` and `film` rendering (P4); community gallery UI (P4); replacing
GitHub auth; Stripe DLC completion.

---

## 5. Verification

| Check | Pass condition |
|---|---|
| Old client compatibility | Launcher 1.3.1 against the new `games.json` loads, shows GODSpeed, does not crash or show the tower |
| Public download, signed out | Fresh profile, no token: tower assets download successfully |
| Gated content unaffected | Signed in: GODSpeed install/update still works |
| Catalog fallback | Catalog with no `items[]` still renders via legacy arrays |
| Print validity | At least one full tower printed from the published Bambu zip before the release is announced |
| Licence completeness | `LICENSE`, `TRADEMARK.md` and README licence section all present and consistent |

## 6. Dependencies

1. CAD, photos and assembly video — office PC / studio (§3.8)
2. Launcher version reconciliation (§4.4)
3. Hero image — currently one portfolio photo, landscape crop prepared in scratchpad
