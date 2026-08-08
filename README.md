# Taste Engine

A personal discovery engine built from your own Spotify library. Unlike
Spotify's own DJ, it's tuned to lean into deep cuts you haven't saved yet —
pulled from artists you already listen to — rather than replaying songs you
already know. A slider on the dashboard controls exactly how new-vs-familiar
the mix should be, live, no restart needed. Everything streams to your phone
via Spotify Connect.

## 1. Update your Spotify app's redirect URI

In your [Spotify Developer Dashboard](https://developer.spotify.com/dashboard),
open your app → Settings → Redirect URIs, and make sure this exact URI is
added (note the trailing slash):

```
https://caedon44-coder.github.io/Radio/callback/
```

Also make sure **Web API** is checked under "Which API/SDKs are you
planning to use?"

## 2. Push these files to your repo

From inside this folder:

```bash
git init
git remote add origin https://github.com/caedon44-coder/Radio.git
git add -A
git commit -m "Taste Engine"
git branch -M main
git push -u origin main
```

## 3. Turn on GitHub Pages

In the repo on GitHub: **Settings → Pages → Build and deployment → Source:
Deploy from a branch → Branch: main, folder: / (root) → Save**.

After a minute or two, your app will be live at:

```
https://caedon44-coder.github.io/Radio/
```

## 4. Add it to your iPhone home screen

Open that URL in Safari on your iPhone → Share button → **Add to Home
Screen**. It'll open full-screen like a native app from then on.

## 5. Using it

1. Open the **Spotify app** on your phone first (it needs to be running,
   at least in the background, to appear as a playback device).
2. Open **Taste Engine**, tap **Connect Spotify**, and log in.
3. Tap **Refresh** under "Playback device" if your phone doesn't show up
   yet, then select it.
4. Drag the **New vs. familiar** slider to set how often the engine reaches
   for a deep cut you haven't saved versus a song already in your rotation.
   You can adjust it any time — it applies to the next pick.
5. Tap **Start Engine**. It clears out whatever's currently queued on the
   device, then builds a fresh queue from your taste and starts playing
   through the Spotify app on your phone.
6. Add artist names under "Add a taste seed" any time to pull more of
   their catalog into the discovery pool.
7. Tap **Stats** in the nav to see your current top artists and songs,
   ranked, with a time-range toggle (last 4 weeks / 6 months / all time —
   Spotify's own ranges; it doesn't expose literal calendar-year
   boundaries).

## How the mix works

Every pick, the engine flips a weighted coin (the slider) between two pools:

- **Known** — your top tracks (across short/medium/long term), your saved
  (Liked) songs, and recently played tracks. Songs you already have a
  relationship with.
- **Fresh** — deep cuts pulled from the albums of artists you listen to
  (your top artists plus any you've manually seeded) that are checked
  against your saved library and excluded if you've already liked them.
  This is genuinely "songs by artists you know, that you don't already
  have saved" — not a Spotify recommendation, since Spotify retired the
  `/recommendations` endpoint in late 2024.

Each pick shows its album art and a badge (**NEW** or **FAMILIAR**) so you
can see at a glance which pool it came from. The "Up next in your rotation"
list and the "Your taste profile" stats (tracks in rotation, seed artists)
reflect what's actually queued and in your pools — not placeholder numbers.
The queue tops itself up by exactly one track every time Spotify reports
the current song has changed (finished, skipped, or gone to the previous
track), on top of a low-buffer safety net.

The **Stats** tab uses Spotify's actual top-artists/top-tracks data (rank
order + Spotify's global popularity score, 0–100). Spotify doesn't expose
personal play counts via the API, so "Popularity" there is not "how much
you've played this" — it's Spotify's own general popularity metric for
that artist/track. Rank, on the other hand, is genuinely yours.

The VU meter bars are driven by the current track's actual tempo/energy via
Spotify's audio-features endpoint when available. That endpoint requires
extended API access that Development Mode apps typically don't have, so on
most personal setups it'll quietly fall back to a fixed lively pulse instead
of a per-song one — there's no way around this without switching the app to
play audio in-browser via Spotify's Web Playback SDK, a bigger architecture
change (and Premium-only).

### If the UI looks broken after a deploy

`index.html` loads `config.js`, `auth.js`, `spotify.js`, `station.js`, and
`app.js` with a shared `?v=YYYYMMDD` query string. GitHub Pages and mobile
Safari can cache these files individually, so after a deploy that renames or
removes an element ID, a browser can end up running old JS against new HTML
(or vice versa) — usually showing up as controls that silently don't do
anything. Bumping that version string on every deploy forces a clean fetch
of the whole set together. If you ever see broken-looking controls right
after a deploy, a hard refresh (or bumping the version string again) is the
first thing to try.

## Spotify brand/design guideline compliance

Per [developer.spotify.com/documentation/design](https://developer.spotify.com/documentation/design),
this app implements the requirements that actually apply to it:

- **Attribution** — Spotify's official logo assets (downloaded straight from
  their developer site, black variant since this app's theme is entirely
  light-background) appear on the login screen, on the now-playing card
  (a "playing view" per their terms), and on the Stats tab. Sized to their
  documented minimums (full logo ≥70px wide, icon ≥21px).
- **Linking back to Spotify** — the now-playing card has a visible "Listen
  on Spotify" text link; every card in the up-next feed and the Stats lists
  links out to its `open.spotify.com` page (artist/track pages use Spotify's
  own `external_urls.spotify`, straight from the API response).
- **Playback restrictions** — the transport controls read `actions.disallows`
  from Spotify's playback-state response and disable whatever's actually
  restricted (e.g. a Free-tier account not being allowed to skip on demand)
  instead of showing controls that would just fail when tapped.
- **Album artwork** — corner radius matches their spec exactly (8px on
  desktop, 4px on mobile/small devices) rather than this app's own more
  rounded UI style, and art is never cropped, distorted, or overlaid with
  text/logos.
- **Naming/branding** — "Taste Engine" doesn't include or resemble "Spotify"
  in name or mark, and the color system doesn't touch Spotify Green or their
  circle/wave marks, so there's no implied endorsement.

**Intentionally out of scope**, since they don't apply to this app's actual
deployment (a personal, 5-user Development Mode app, not a public listing
going through Spotify's extended-access review):

- **Explicit-content badges** — only required for apps serving South Korea.
- **A "Like"/heart feature** — the guidelines' rules for that feature
  (must signal back to Spotify rather than saving locally, specific icon)
  only matter if the feature exists, and this app doesn't have one.
- **15-second podcast/audiobook seek controls** — this app only plays music,
  not podcasts or audiobooks.

## Good to know

- Your Spotify Developer app is capped at 5 allowlisted users — perfect
  for personal use, but if you ever want to share this with friends,
  you'll need to add them by email under your app's User Management tab
  in the dashboard.
- Everything (tokens, history, seeds, your ratio setting) is stored only in
  your phone's browser storage — nothing goes to a server other than
  Spotify's own API.
