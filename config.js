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

  // How the station mixes content. Every PODCAST_EVERY_N tracks, one
  // podcast episode is dropped into the queue instead of a song.
  PODCAST_EVERY_N: 6,

  // How many upcoming items the app tries to keep queued on the device.
  QUEUE_TARGET_SIZE: 8,

  // How many recent plays to remember, to avoid near-term repeats.
  HISTORY_MEMORY: 40
};
