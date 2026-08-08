// ---- Thin wrapper around the Spotify Web API endpoints we're allowed to use ----

const API_BASE = "https://api.spotify.com/v1";

async function spotifyFetch(path, options = {}) {
  const token = await getValidAccessToken();
  if (!token) throw new Error("Not logged in");

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers
    }
  });

  if (res.status === 204) return null; // e.g. no active device, or command accepted with no body
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Spotify API ${res.status} on ${path}: ${errBody}`);
  }
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (e) {
    // A 2xx response with a body that isn't valid JSON - seen in practice on
    // some player-control endpoints. The caller almost never needs this
    // body (play/pause/queue/skip commands are fire-and-forget), so don't
    // let a parse hiccup here abort the whole calling flow.
    console.warn(`Non-JSON response from ${path}:`, text.slice(0, 200));
    return null;
  }
}

const Spotify = {
  getMe: () => spotifyFetch("/me"),

  // Personalisation
  getTopItems: (type, timeRange = "medium_term", limit = 10) =>
    spotifyFetch(`/me/top/${type}?time_range=${timeRange}&limit=${limit}`),

  // Library
  getSavedTracks: (limit = 20, offset = 0) =>
    spotifyFetch(`/me/tracks?limit=${limit}&offset=${offset}`),
  // Returns booleans in the same order as ids (max 50 ids per call).
  checkSavedTracks: (ids) => spotifyFetch(`/me/tracks/contains?ids=${ids.join(",")}`),

  // Catalog
  getArtistAlbums: (artistId, limit = 10) =>
    spotifyFetch(`/artists/${artistId}/albums?limit=${limit}&include_groups=album,single`),
  getAlbumTracks: (albumId, limit = 20) =>
    spotifyFetch(`/albums/${albumId}/tracks?limit=${limit}`),
  // Tempo/energy for the VU meter. Restricted to apps with extended API
  // access as of late 2024 - expect this to 403 in Development Mode.
  getAudioFeatures: (trackId) => spotifyFetch(`/audio-features/${trackId}`),

  // Search (max limit is 10 as of Feb 2026)
  search: (query, types, limit = 10) =>
    spotifyFetch(`/search?q=${encodeURIComponent(query)}&type=${types}&limit=${limit}`),

  // Recently played
  getRecentlyPlayed: (limit = 20) =>
    spotifyFetch(`/me/player/recently-played?limit=${limit}`),

  // Player / Spotify Connect controls
  getDevices: () => spotifyFetch("/me/player/devices"),
  getPlaybackState: () => spotifyFetch("/me/player"),
  getCurrentQueue: () => spotifyFetch("/me/player/queue"),

  transferPlayback: (deviceId, play = true) =>
    spotifyFetch("/me/player", {
      method: "PUT",
      body: JSON.stringify({ device_ids: [deviceId], play })
    }),

  startPlayback: (deviceId, uris) =>
    spotifyFetch(`/me/player/play?device_id=${deviceId}`, {
      method: "PUT",
      body: JSON.stringify({ uris })
    }),

  addToQueue: (uri, deviceId) =>
    spotifyFetch(`/me/player/queue?uri=${encodeURIComponent(uri)}&device_id=${deviceId}`, {
      method: "POST"
    }),

  // No device_id on these transport commands: they target whatever Spotify
  // currently considers the active device, rather than a device id we
  // cached at page load that may have gone stale (Spotify Connect sessions
  // can rotate device ids).
  skipNext: () => spotifyFetch("/me/player/next", { method: "POST" }),
  skipPrevious: () => spotifyFetch("/me/player/previous", { method: "POST" }),
  pause: () => spotifyFetch("/me/player/pause", { method: "PUT" }),
  // Resumes whatever was already loaded, unlike startPlayback which always
  // supplies a fresh track list.
  resume: () => spotifyFetch("/me/player/play", { method: "PUT" })
};
