// ---- Taste Engine configuration ----
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

  // Default share of picks pulled from the "fresh" pool (deep cuts from
  // artists you listen to that aren't in your saved library) vs the
  // "known" pool (top tracks, saved tracks, recently played). Adjustable
  // live from the dashboard slider; this is just the starting value.
  NEW_TRACK_RATIO: 0.65,

  // How many upcoming items the app tries to keep queued on the device.
  QUEUE_TARGET_SIZE: 8,

  // How many recent plays to remember, to avoid near-term repeats.
  HISTORY_MEMORY: 40
};
