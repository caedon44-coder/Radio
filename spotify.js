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
  return text ? JSON.parse(text) : null;
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

  skipNext: (deviceId) =>
    spotifyFetch(`/me/player/next?device_id=${deviceId}`, { method: "POST" }),

  pause: (deviceId) =>
    spotifyFetch(`/me/player/pause?device_id=${deviceId}`, { method: "PUT" })
};
