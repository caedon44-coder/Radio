// ---- The "station" itself: taste pool assembly + mixing logic ----
// No /recommendations endpoint exists anymore, so discovery here is honest:
// your top tracks + saved tracks + recently played + deep cuts pulled from
// your favorite artists' other albums, shuffled with memory, plus podcast
// episodes from shows you follow. You can also add manual "seed" artists.

const STATION_STORAGE_KEYS = {
  history: "station_history", // recently queued URIs, oldest first
  seeds: "station_seed_artists", // manually added artist names -> id
  episodeCursor: "station_episode_cursor" // per-show index of next unplayed episode
};

function loadJSON(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}
function saveJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

const Station = {
  trackPool: [], // { uri, name, artist }
  episodePool: [], // { uri, name, show }
  tracksSincePodcast: 0,

  log(msg) {
    const el = document.getElementById("log");
    if (el) {
      el.textContent = msg + "\n" + el.textContent;
    }
    console.log(msg);
  },

  getHistory() {
    return loadJSON(STATION_STORAGE_KEYS.history, []);
  },
  remember(uri) {
    const hist = this.getHistory();
    hist.push(uri);
    while (hist.length > CONFIG.HISTORY_MEMORY) hist.shift();
    saveJSON(STATION_STORAGE_KEYS.history, hist);
  },
  wasRecentlyPlayed(uri) {
    return this.getHistory().includes(uri);
  },

  getSeedArtists() {
    return loadJSON(STATION_STORAGE_KEYS.seeds, []); // [{id, name}]
  },

  // Add a manually-named artist as a taste seed. Pulls their catalog in
  // alongside your existing top artists.
  async addSeedArtist(name) {
    const result = await Spotify.search(name, "artist", 5);
    const artist = result?.artists?.items?.[0];
    if (!artist) throw new Error(`No artist found for "${name}"`);

    const seeds = this.getSeedArtists();
    if (!seeds.some((s) => s.id === artist.id)) {
      seeds.push({ id: artist.id, name: artist.name });
      saveJSON(STATION_STORAGE_KEYS.seeds, seeds);
    }
    return artist.name;
  },

  // Pull a handful of tracks from an artist's albums (deep cuts, not just hits,
  // since Get Artist's Top Tracks was removed in Feb 2026).
  async tracksForArtist(artistId, maxAlbums = 2, maxTracksPerAlbum = 4) {
    const out = [];
    try {
      const albums = await Spotify.getArtistAlbums(artistId, maxAlbums);
      for (const album of albums?.items || []) {
        const tracks = await Spotify.getAlbumTracks(album.id, maxTracksPerAlbum);
        for (const t of tracks?.items || []) {
          out.push({ uri: t.uri, name: t.name, artist: t.artists?.[0]?.name || "" });
        }
      }
    } catch (e) {
      this.log(`Couldn't pull catalog for artist ${artistId}: ${e.message}`);
    }
    return out;
  },

  // Assemble the pool of candidate tracks from every taste source we have.
  async buildTrackPool() {
    const pool = [];
    const seenUris = new Set();
    const addAll = (items) => {
      for (const t of items) {
        if (t?.uri && !seenUris.has(t.uri)) {
          seenUris.add(t.uri);
          pool.push(t);
        }
      }
    };

    // Top tracks across time ranges, for a mix of old favorites + current rotation
    for (const range of ["short_term", "medium_term", "long_term"]) {
      try {
        const top = await Spotify.getTopItems("tracks", range, 10);
        addAll(
          (top?.items || []).map((t) => ({
            uri: t.uri,
            name: t.name,
            artist: t.artists?.[0]?.name || ""
          }))
        );
      } catch (e) {
        this.log(`Top tracks (${range}) unavailable: ${e.message}`);
      }
    }

    // Saved (liked) tracks
    try {
      const saved = await Spotify.getSavedTracks(20);
      addAll(
        (saved?.items || []).map((i) => ({
          uri: i.track?.uri,
          name: i.track?.name,
          artist: i.track?.artists?.[0]?.name || ""
        }))
      );
    } catch (e) {
      this.log(`Saved tracks unavailable: ${e.message}`);
    }

    // Recently played
    try {
      const recent = await Spotify.getRecentlyPlayed(20);
      addAll(
        (recent?.items || []).map((i) => ({
          uri: i.track?.uri,
          name: i.track?.name,
          artist: i.track?.artists?.[0]?.name || ""
        }))
      );
    } catch (e) {
      this.log(`Recently played unavailable: ${e.message}`);
    }

    // Deep cuts from top artists' catalogs
    try {
      const topArtists = await Spotify.getTopItems("artists", "medium_term", 5);
      for (const artist of topArtists?.items || []) {
        addAll(await this.tracksForArtist(artist.id));
      }
    } catch (e) {
      this.log(`Top artists unavailable: ${e.message}`);
    }

    // Manually seeded artists
    for (const seed of this.getSeedArtists()) {
      addAll(await this.tracksForArtist(seed.id));
    }

    this.trackPool = pool;
    return pool;
  },

  // Assemble the pool of candidate podcast episodes from followed shows.
  async buildEpisodePool() {
    const pool = [];
    const cursor = loadJSON(STATION_STORAGE_KEYS.episodeCursor, {});

    try {
      const shows = await Spotify.getSavedShows(20);
      for (const item of shows?.items || []) {
        const show = item.show;
        if (!show) continue;
        const episodes = await Spotify.getShowEpisodes(show.id, 10);
        const items = episodes?.items || [];
        if (items.length === 0) continue;

        // Play the show's episodes oldest-unplayed-first rather than always
        // the same latest episode.
        const idx = Math.min(cursor[show.id] || 0, items.length - 1);
        const ep = items[idx];
        if (ep?.uri) {
          pool.push({ uri: ep.uri, name: ep.name, show: show.name, showId: show.id });
        }
      }
    } catch (e) {
      this.log(`Saved shows unavailable: ${e.message}`);
    }

    this.episodePool = pool;
    return pool;
  },

  advanceEpisodeCursor(showId) {
    const cursor = loadJSON(STATION_STORAGE_KEYS.episodeCursor, {});
    cursor[showId] = (cursor[showId] || 0) + 1;
    saveJSON(STATION_STORAGE_KEYS.episodeCursor, cursor);
  },

  // Pick the next item to queue: mostly tracks, occasionally an episode,
  // always avoiding anything queued too recently.
  pickNext() {
    this.tracksSincePodcast++;

    if (this.tracksSincePodcast >= CONFIG.PODCAST_EVERY_N && this.episodePool.length > 0) {
      const idx = Math.floor(Math.random() * this.episodePool.length);
      const ep = this.episodePool.splice(idx, 1)[0];
      this.tracksSincePodcast = 0;
      this.advanceEpisodeCursor(ep.showId);
      return { type: "episode", item: ep };
    }

    const fresh = this.trackPool.filter((t) => !this.wasRecentlyPlayed(t.uri));
    const source = fresh.length > 0 ? fresh : this.trackPool;
    if (source.length === 0) return null;

    const idx = Math.floor(Math.random() * source.length);
    const track = source[idx];
    this.trackPool = this.trackPool.filter((t) => t.uri !== track.uri);
    return { type: "track", item: track };
  },

  async refillPools() {
    await Promise.all([this.buildTrackPool(), this.buildEpisodePool()]);
  }
};
