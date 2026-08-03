// ---- Station configuration ----
// This is a personal, single-user app (Spotify Developer Mode, 5-user cap),
// so it's fine for the Client ID to live in client-side code.

const CONFIG = {
  CLIENT_ID: "5b294a270c544a9a81c9930109cf9715",
  REDIRECT_URI: "https://caedon44-coder.github.io/Radio/callback/",
  SCOPES: [
    "user-top-read",
    "user-read-recently-played",
    "user-read-playback-state",
    "user-modify-playback-state",
    "user-library-read"
  ].join(" "),

  // YouTube Data API v3 key. Create one in Google Cloud Console and restrict
  // it by HTTP referrer to your GitHub Pages origin (see README).
  YT_API_KEY: "AIzaSyDLp3daijMDYe03Fwi5xFDAXl_of6R6OoM",

  // Videos shorter than this are treated as Shorts/clips and filtered out
  // of the long-form pool.
  YT_MIN_DURATION_MINUTES: 15,

  // How the station mixes content. Every LONGFORM_EVERY_N tracks, one
  // podcast episode or YouTube video is dropped into the queue instead of
  // a song (whichever pool has something available).
  LONGFORM_EVERY_N: 6,

  // How many upcoming items the app tries to keep queued on the device.
  QUEUE_TARGET_SIZE: 8,

  // How many recent plays to remember, to avoid near-term repeats.
  HISTORY_MEMORY: 40
};
