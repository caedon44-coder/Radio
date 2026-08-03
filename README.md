# Your Station

A personal radio station built from your own Spotify library — top tracks,
saved songs, deep cuts from your favorite artists' catalogs, and episodes
from the podcasts you follow — mixed together and streamed to your phone
via Spotify Connect. Optionally mixes in long-form YouTube video too (see
step 2 below).

## 1. Update your Spotify app's redirect URI

In your [Spotify Developer Dashboard](https://developer.spotify.com/dashboard),
open your app → Settings → Redirect URIs, and make sure this exact URI is
added (note the trailing slash):

```
https://caedon44-coder.github.io/Radio/callback/
```

Also make sure **Web API** is checked under "Which API/SDKs are you
planning to use?"

## 2. (Optional) Set up YouTube long-form content

If you want YouTube videos (lectures, essays, long podcasts-on-YouTube, etc.)
mixed into the rotation alongside your podcast episodes:

1. In the [Google Cloud Console](https://console.cloud.google.com/), create a
   project (or reuse one), then enable the **YouTube Data API v3** under
   "APIs & Services".
2. Under "Credentials", create an **API key**, then restrict it: set
   "Application restrictions" to **HTTP referrers** and add
   `https://caedon44-coder.github.io/*`. Also restrict "API restrictions" to
   just **YouTube Data API v3**. This key is public in client-side code (same
   trust model as the Spotify Client ID above), so the referrer restriction is
   what keeps it from being abused elsewhere.
3. Paste the key into `YT_API_KEY` in [config.js](radio-app/config.js).

If you skip this, the app works exactly as before — the YouTube pool just
stays empty and only podcast episodes fill the long-form slot.

**Important:** unlike Spotify, which plays through your phone's Spotify app in
the background via Spotify Connect, YouTube has no equivalent remote-playback
API. Video segments play through an embedded player inside this app itself,
which means **the app needs to be open and the screen on** for a video segment
to keep playing — it will not continue in the background or with the screen
locked. Music and podcast segments are unaffected and keep working through
Spotify Connect as before.

## 3. Push these files to your repo

From inside this folder:

```bash
git init
git remote add origin https://github.com/caedon44-coder/Radio.git
git add -A
git commit -m "Your Station"
git branch -M main
git push -u origin main
```

## 4. Turn on GitHub Pages

In the repo on GitHub: **Settings → Pages → Build and deployment → Source:
Deploy from a branch → Branch: main, folder: / (root) → Save**.

After a minute or two, your app will be live at:

```
https://caedon44-coder.github.io/Radio/
```

## 5. Add it to your iPhone home screen

Open that URL in Safari on your iPhone → Share button → **Add to Home
Screen**. It'll open full-screen like a native app from then on.

## 6. Using it

1. Open the **Spotify app** on your phone first (it needs to be running,
   at least in the background, to appear as a playback device).
2. Open **Your Station**, tap **Connect Spotify**, and log in.
3. Tap **Refresh** under "Playback device" if your phone doesn't show up
   yet, then select it.
4. Tap **Start Station**. It builds a queue from your taste and starts
   playing through the Spotify app on your phone.
5. Add artist names under "Add a taste seed" any time to pull more of
   their catalog into the mix.
6. If you set up `YT_API_KEY`, add channel URLs, `@handles`, or playlist
   URLs under "Add a YouTube channel or playlist" to pull long-form video
   into the mix. It competes with podcast episodes for the same slot
   (every `LONGFORM_EVERY_N` tracks, in [config.js](radio-app/config.js)).
   When a video comes up, keep the app open and the screen on — see the
   caveat in step 2.

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
