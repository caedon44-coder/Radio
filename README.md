# Taste Engine

A personal discovery engine built from your own Spotify library. Unlike
Spotify's own DJ, it's tuned to lean into deep cuts you haven't saved yet —
pulled from artists you already listen to — rather than replaying songs you
already know. A slider on the dashboard controls exactly how new-vs-familiar
the mix should be, live, no restart needed. Podcast episodes from shows you
follow get mixed in too. Everything streams to your phone via Spotify
Connect.

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
5. Tap **Start Engine**. It builds a queue from your taste and starts
   playing through the Spotify app on your phone.
6. Add artist names under "Add a taste seed" any time to pull more of
   their catalog into the discovery pool.

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

Podcast episodes from shows you follow are mixed in on top of that, every
`PODCAST_EVERY_N` tracks (in [config.js](radio-app/config.js)), independent
of the new/familiar ratio.

## Good to know

- Your Spotify Developer app is capped at 5 allowlisted users — perfect
  for personal use, but if you ever want to share this with friends,
  you'll need to add them by email under your app's User Management tab
  in the dashboard.
- Everything (tokens, history, seeds, your ratio setting) is stored only in
  your phone's browser storage — nothing goes to a server other than
  Spotify's own API.
