# Your Station

A personal radio station built from your own Spotify library — top tracks,
saved songs, deep cuts from your favorite artists' catalogs, and episodes
from the podcasts you follow — mixed together and streamed to your phone
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
git commit -m "Your Station"
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
2. Open **Your Station**, tap **Connect Spotify**, and log in.
3. Tap **Refresh** under "Playback device" if your phone doesn't show up
   yet, then select it.
4. Tap **Start Station**. It builds a queue from your taste and starts
   playing through the Spotify app on your phone.
5. Add artist names under "Add a taste seed" any time to pull more of
   their catalog into the mix.

## Good to know

- Spotify retired the "recommendations" API in late 2024, so this app
  doesn't get novel AI-picked songs from Spotify — it draws from your
  actual library and artists' full discographies instead, shuffled with
  memory so things don't repeat too soon.
- Your Spotify Developer app is capped at 5 allowlisted users — perfect
  for personal use, but if you ever want to share this with friends,
  you'll need to add them by email under your app's User Management tab
  in the dashboard.
- Everything (tokens, history, seeds) is stored only in your phone's
  browser storage — nothing goes to a server other than Spotify's own API.
"# Radio" 
"# Radio" 
